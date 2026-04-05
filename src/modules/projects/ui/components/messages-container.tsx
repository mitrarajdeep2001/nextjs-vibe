import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";
import type { Fragment } from "@prisma/client";

import { MessageCard } from "./message-card";
import { MessageForm } from "./message-form";
import { MessageLoading } from "./message-loading";

interface Props {
  projectId: string;
  activeFragment: Fragment | null;
  setActiveFragment: (fragment: Fragment | null) => void;
};

export const MessagesContainer = ({ 
  projectId,
  activeFragment,
  setActiveFragment
}: Props) => {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastAssistantMessageIdRef = useRef<string | null>(null);

  const { data: messages } = useSuspenseQuery(trpc.messages.getMany.queryOptions({
    projectId: projectId,
  }, {
    refetchInterval: 2000,
  }));

  const retryMessage = useMutation(trpc.messages.create.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries(
        trpc.messages.getMany.queryOptions({ projectId }),
      );
      queryClient.invalidateQueries(
        trpc.usage.status.queryOptions(),
      );
    },
    onError: (error) => {
      toast.error(error.message);
      if (error.data?.code === "TOO_MANY_REQUESTS") {
        router.push("/pricing");
      }
    },
  }));

  useEffect(() => {
    const lastAssistantMessage = messages.findLast(
      (message) => message.role === "ASSISTANT"
    );

    if (
      lastAssistantMessage?.fragment &&
      lastAssistantMessage.id !== lastAssistantMessageIdRef.current
    ) {
      setActiveFragment(lastAssistantMessage.fragment);
      lastAssistantMessageIdRef.current = lastAssistantMessage.id;
    }
  }, [messages, setActiveFragment]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView();
  }, [messages.length]);

  const lastMessage = messages[messages.length - 1];
  const isLastMessageUser = lastMessage?.role === "USER";
  const lastUserMessage = [...messages].reverse().find(
    (message) => message.role === "USER",
  );
  const lastAssistantError = [...messages].reverse().find(
    (message) => message.role === "ASSISTANT" && message.type === "ERROR",
  );

  const handleRetry = async () => {
    if (!lastUserMessage?.content || retryMessage.isPending) return;

    await retryMessage.mutateAsync({
      value: lastUserMessage.content,
      projectId,
    });
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="pr-1 pt-3">
          {messages.map((message) => (
            <MessageCard
              key={message.id}
              content={message.content}
              role={message.role}
              fragment={message.fragment}
              createdAt={message.createdAt}
              isActiveFragment={activeFragment?.id === message.fragment?.id}
              onFragmentClick={() => setActiveFragment(message.fragment)}
              type={message.type}
              showRetry={message.id === lastAssistantError?.id}
              isRetrying={retryMessage.isPending}
              onRetry={handleRetry}
            />
          ))}
          {isLastMessageUser && <MessageLoading />}
          <div ref={bottomRef} />
        </div>
      </div>
      <div className="relative border-t border-border/60 p-3">
        <div className="absolute -top-6 left-0 right-0 h-6 bg-gradient-to-b from-transparent to-background pointer-events-none" />
        <MessageForm projectId={projectId} />
      </div>
    </div>
  );
};
