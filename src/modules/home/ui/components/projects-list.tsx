"use client";

import Link from "next/link";
import Image from "next/image";
import { toast } from "sonner";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { Loader2Icon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const ProjectsList = () => {
  const trpc = useTRPC();
  const router = useRouter();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const { data: projects } = useQuery(trpc.projects.getMany.queryOptions());
  const [projectToDelete, setProjectToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const deleteProject = useMutation(trpc.projects.delete.mutationOptions({
    onSuccess: () => {
      toast.success("Project deleted");
      queryClient.invalidateQueries(trpc.projects.getMany.queryOptions());
      setProjectToDelete(null);
      router.refresh();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  }));

  if (!user) return null;

  return (
    <>
      <div className="w-full bg-white dark:bg-sidebar rounded-xl p-8 border flex flex-col gap-y-6 sm:gap-y-4">
        <h2 className="text-2xl font-semibold">
          {user?.firstName}&apos;s Vibes
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {projects?.length === 0 && (
            <div className="col-span-full text-center">
              <p className="text-sm text-muted-foreground">
                No projects found
              </p>
            </div>
          )}
          {projects?.map((project) => (
            <div
              key={project.id}
              className="border rounded-md p-4 flex items-center gap-x-3"
            >
              <Link href={`/projects/${project.id}`} className="flex-1 min-w-0">
                <div className="flex items-center gap-x-4">
                  <Image
                    src="/logo.svg"
                    alt="Vibe"
                    width={32}
                    height={32}
                    className="object-contain"
                  />
                  <div className="flex flex-col min-w-0">
                    <h3 className="truncate font-medium">
                      {project.name}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {formatDistanceToNow(project.updatedAt, {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                </div>
              </Link>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setProjectToDelete({
                  id: project.id,
                  name: project.name,
                })}
                aria-label={`Delete ${project.name}`}
              >
                <Trash2Icon className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      </div>
      <AlertDialog
        open={!!projectToDelete}
        onOpenChange={(open) => {
          if (!open) {
            setProjectToDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete
              {" "}
              <span className="font-medium">{projectToDelete?.name}</span>
              {" "}
              and all of its messages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteProject.isPending}>
              Cancel
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteProject.isPending || !projectToDelete}
              onClick={() => {
                if (!projectToDelete) return;
                deleteProject.mutate({ id: projectToDelete.id });
              }}
            >
              {deleteProject.isPending ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" />
                  <span>Deleting...</span>
                </>
              ) : (
                "Delete project"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
