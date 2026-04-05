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
import { FRAGMENT_TITLE_PROMPT, PROMPT, RESPONSE_PROMPT } from "@/prompt";

import { inngest } from "./client";
import { SANDBOX_TIMEOUT } from "./types";
import {
  getSandbox,
  lastAssistantTextMessageContent,
  parseAgentOutput,
} from "./utils";

interface AgentState {
  summary: string;
  files: { [path: string]: string };
}

interface BuildValidationResult {
  ok: boolean;
  output: string;
}

const GEMINI_MODEL_FALLBACKS = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
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
        maxIter: 15,
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

    const runBuildValidation = async (
      attempt: number,
    ): Promise<BuildValidationResult> => {
      return await step.run(`validate-build-${attempt}`, async () => {
        const sandbox = await getSandbox(sandboxId);
        let stdout = "";
        let stderr = "";

        try {
          const result = await sandbox.commands.run("npm run build", {
            onStdout: (data: string) => {
              stdout += data;
            },
            onStderr: (data: string) => {
              stderr += data;
            },
          });

          const output = `${stdout}\n${stderr}`.trim().slice(-12000);
          return {
            ok: (result.exitCode ?? 1) === 0,
            output,
          };
        } catch (error) {
          const output =
            `${stdout}\n${stderr}\n${String(error)}`.trim().slice(-12000);
          return {
            ok: false,
            output,
          };
        }
      });
    };

    let selectedModel: (typeof GEMINI_MODEL_FALLBACKS)[number] | null = null;
    let rateLimitFailure = false;
    let result: Awaited<ReturnType<ReturnType<typeof buildNetwork>["run"]>> | null = null;
    let buildValidation: BuildValidationResult = {
      ok: false,
      output: "",
    };

    for (const model of GEMINI_MODEL_FALLBACKS) {
      try {
        state.data.summary = "";

        const network = buildNetwork(model);
        result = await network.run(event.data.value, { state });
        buildValidation = await runBuildValidation(0);

        for (let attempt = 1; attempt <= 2 && !buildValidation.ok; attempt++) {
          state.data.summary = "";

          const retryPrompt = [
            event.data.value,
            "",
            "Your previous output still has build errors.",
            "Fix all errors below, then run `npm run build` again before finalizing.",
            "",
            "<build_errors>",
            buildValidation.output || "Build failed with no logs captured.",
            "</build_errors>",
          ].join("\n");

          result = await network.run(retryPrompt, { state });
          buildValidation = await runBuildValidation(attempt);
        }

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

    let fragmentTitleOutput: Message[] = [];
    let responseOutput: Message[] = [];

    if (selectedModel && result?.state.data.summary) {
      const fragmentTitleGenerator = createAgent({
        name: "fragment-title-generator",
        description: "A fragment title generator",
        system: FRAGMENT_TITLE_PROMPT,
        model: gemini({
          model: selectedModel,
        }),
      });

      const responseGenerator = createAgent({
        name: "response-generator",
        description: "A response generator",
        system: RESPONSE_PROMPT,
        model: gemini({
          model: selectedModel,
        }),
      });

      try {
        ({ output: fragmentTitleOutput } = await fragmentTitleGenerator.run(
          result.state.data.summary,
        ));
      } catch (error) {
        if (!isGeminiRateLimitError(error)) {
          throw error;
        }
      }

      try {
        ({ output: responseOutput } = await responseGenerator.run(
          result.state.data.summary,
        ));
      } catch (error) {
        if (!isGeminiRateLimitError(error)) {
          throw error;
        }
      }
    }

    const isRateLimitedAcrossAllModels = !selectedModel && rateLimitFailure;

    const isError =
      isRateLimitedAcrossAllModels ||
      !result?.state.data.summary ||
      Object.keys(result?.state.data.files || {}).length === 0 ||
      !buildValidation.ok;

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
          content: responseOutput.length > 0
            ? parseAgentOutput(responseOutput)
            : "Your app is ready. I built and validated it successfully.",
          role: "ASSISTANT",
          type: "RESULT",
          fragment: {
            create: {
              sandboxUrl: sandboxUrl,
              title: fragmentTitleOutput.length > 0
                ? parseAgentOutput(fragmentTitleOutput)
                : "Generated App",
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
