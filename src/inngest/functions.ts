import { z } from "zod";
import { Sandbox } from "@e2b/code-interpreter";
import {
  gemini,
  createAgent,
  createTool,
  createNetwork,
  type Tool,
  type Message,
  createState,
} from "@inngest/agent-kit";

import { prisma } from "@/lib/db";
import { PROMPT } from "@/prompt";

import { inngest } from "./client";
import { SANDBOX_TIMEOUT } from "./types";
import {
  getSandbox,
  lastAssistantTextMessageContent,
} from "./utils";

interface AgentState {
  summary: string;
  files: { [path: string]: string };
}

const GEMINI_MODEL_FALLBACKS = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
] as const;

const serializeError = (error: unknown) => {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const isGeminiRateLimitError = (error: unknown) => {
  const message = serializeError(error).toLowerCase();

  return (
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("resource_exhausted") ||
    message.includes("quota")
  );
};

export const codeAgentFunction = inngest.createFunction(
  { id: "code-agent" },
  { event: "code-agent/run" },
  async ({ event, step }) => {
    const sandboxId = await step.run("get-sandbox-id", async () => {
      const sandbox = await Sandbox.create("vibe-nextjs-template");
      await sandbox.setTimeout(SANDBOX_TIMEOUT);
      return sandbox.sandboxId;
    });

    const previousMessages = await step.run(
      "get-previous-messages",
      async () => {
        const formattedMessages: Message[] = [];

        const messages = await prisma.message.findMany({
          where: {
            projectId: event.data.projectId,
          },
          orderBy: {
            createdAt: "desc",
          },
          take: 5,
        });

        for (const message of messages) {
          formattedMessages.push({
            type: "text",
            role: message.role === "ASSISTANT" ? "assistant" : "user",
            content: message.content,
          });
        }

        return formattedMessages.reverse();
      },
    );

    const state = createState<AgentState>(
      {
        summary: "",
        files: {},
      },
      {
        messages: previousMessages,
      },
    );

    const tools = [
      createTool({
        name: "terminal",
        description: "Use the terminal to run commands",
        parameters: z.object({
          command: z.string(),
        }),
        handler: async ({ command }, { step }) => {
          return await step?.run("terminal", async () => {
            const buffers = { stdout: "", stderr: "" };

            try {
              const sandbox = await getSandbox(sandboxId);
              const result = await sandbox.commands.run(command, {
                onStdout: (data: string) => {
                  buffers.stdout += data;
                },
                onStderr: (data: string) => {
                  buffers.stderr += data;
                },
              });
              return result.stdout;
            } catch (e) {
              console.error(
                `Command failed: ${e} \nstdout: ${buffers.stdout}\nstderror: ${buffers.stderr}`,
              );
              return `Command failed: ${e} \nstdout: ${buffers.stdout}\nstderr: ${buffers.stderr}`;
            }
          });
        },
      }),
      createTool({
        name: "createOrUpdateFiles",
        description: "Create or update files in the sandbox",
        parameters: z.object({
          files: z.array(
            z.object({
              path: z.string(),
              content: z.string(),
            }),
          ),
        }),
        handler: async (
          { files },
          { step, network }: Tool.Options<AgentState>,
        ) => {
          const newFiles = await step?.run(
            "createOrUpdateFiles",
            async () => {
              try {
                const updatedFiles = network.state.data.files || {};
                const sandbox = await getSandbox(sandboxId);
                for (const file of files) {
                  await sandbox.files.write(file.path, file.content);
                  updatedFiles[file.path] = file.content;
                }

                return updatedFiles;
              } catch (e) {
                return "Error: " + e;
              }
            },
          );

          if (typeof newFiles === "object") {
            network.state.data.files = newFiles;
          }
        },
      }),
      createTool({
        name: "readFiles",
        description: "Read files from the sandbox",
        parameters: z.object({
          files: z.array(z.string()),
        }),
        handler: async ({ files }, { step }) => {
          return await step?.run("readFiles", async () => {
            try {
              const sandbox = await getSandbox(sandboxId);
              const contents = [];
              for (const file of files) {
                const content = await sandbox.files.read(file);
                contents.push({ path: file, content });
              }
              return JSON.stringify(contents);
            } catch (e) {
              return "Error: " + e;
            }
          });
        },
      }),
    ];

    const buildNetwork = (model: string) => {
      const codeAgent = createAgent<AgentState>({
        name: "code-agent",
        description: "An expert coding agent",
        system: PROMPT,
        model: gemini({
          model,
        }),
        tools,
        lifecycle: {
          onResponse: async ({ result, network }) => {
            const lastAssistantMessageText =
              lastAssistantTextMessageContent(result);

            if (lastAssistantMessageText && network) {
              if (lastAssistantMessageText.includes("<task_summary>")) {
                network.state.data.summary = lastAssistantMessageText;
              }
            }

            return result;
          },
        },
      });

      return createNetwork<AgentState>({
        name: "coding-agent-network",
        agents: [codeAgent],
        maxIter: 1,
        defaultState: state,
        router: async ({ network }) => {
          const summary = network.state.data.summary;

          if (summary) {
            return;
          }

          return codeAgent;
        },
      });
    };

    let selectedModel: (typeof GEMINI_MODEL_FALLBACKS)[number] | null = null;
    let rateLimitFailure = false;
    let result: Awaited<ReturnType<ReturnType<typeof buildNetwork>["run"]>> | null = null;

    for (const model of GEMINI_MODEL_FALLBACKS) {
      try {
        state.data.summary = "";

        const network = buildNetwork(model);
        result = await network.run(event.data.value, { state });

        selectedModel = model;
        break;
      } catch (error) {
        if (isGeminiRateLimitError(error)) {
          rateLimitFailure = true;
          continue;
        }

        throw error;
      }
    }

    const isRateLimitedAcrossAllModels = !selectedModel && rateLimitFailure;
    const summaryText = result?.state.data.summary || "";
    const cleanSummary = summaryText
      .replace(/<task_summary>/gi, "")
      .replace(/<\/task_summary>/gi, "")
      .trim();

    const isError =
      isRateLimitedAcrossAllModels ||
      !summaryText ||
      Object.keys(result?.state.data.files || {}).length === 0;

    const sandboxUrl = await step.run("get-sandbox-url", async () => {
      const sandbox = await getSandbox(sandboxId);
      const host = sandbox.getHost(3000);
      return `https://${host}`;
    });

    await step.run("save-result", async () => {
      if (isError) {
        const errorMessage = isRateLimitedAcrossAllModels
          ? "Gemini is rate-limited right now across available models. Please try again in a few minutes, then press Retry."
          : "Something went wrong. Please try again.";

        return await prisma.message.create({
          data: {
            projectId: event.data.projectId,
            content: errorMessage,
            role: "ASSISTANT",
            type: "ERROR",
          },
        });
      }

      return await prisma.message.create({
        data: {
          projectId: event.data.projectId,
          content: cleanSummary || "Your app is ready.",
          role: "ASSISTANT",
          type: "RESULT",
          fragment: {
            create: {
              sandboxUrl: sandboxUrl,
              title: "Generated App",
              files: result!.state.data.files,
            },
          },
        },
      });
    });

    return {
      url: sandboxUrl,
      title: "Fragment",
      files: result?.state.data.files || {},
      summary: result?.state.data.summary || "",
    };
  },
);
