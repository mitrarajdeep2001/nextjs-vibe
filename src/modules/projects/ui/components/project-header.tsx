import Link from "next/link";
import Image from "next/image";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  Loader2Icon,
  Trash2Icon,
  SunMoonIcon,
} from "lucide-react";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Props {
  projectId: string;
}

export const ProjectHeader = ({ projectId }: Props) => {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const { data: project } = useSuspenseQuery(
    trpc.projects.getOne.queryOptions({ id: projectId })
  );

  const deleteProject = useMutation(trpc.projects.delete.mutationOptions({
    onSuccess: () => {
      toast.success("Project deleted");
      queryClient.invalidateQueries(trpc.projects.getMany.queryOptions());
      setIsDeleteDialogOpen(false);
      router.push("/");
      router.refresh();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  }));

  const { setTheme, theme } = useTheme();

  return (
    <>
      <header className="p-2 flex justify-between items-center border-b">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="focus-visible:ring-0 hover:bg-transparent hover:opacity-75 transition-opacity pl-2!"
            >
              <Image src="/logo.svg" alt="Vibe" width={18} height={18} />
              <span className="text-sm font-medium">{project.name}</span>
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="start">
            <DropdownMenuItem asChild>
              <Link href="/">
                <ChevronLeftIcon />
                <span>
                  Go to Dashboard
                </span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2">
                <SunMoonIcon className="size-4 text-muted-foreground" />
                <span>Appearance</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
                    <DropdownMenuRadioItem value="light">
                      <span>Light</span>
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="dark">
                      <span>Dark</span>
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="system">
                      <span>System</span>
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={(e) => {
                e.preventDefault();
                setIsDeleteDialogOpen(true);
              }}
            >
              <Trash2Icon />
              <span>Delete Project</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete
              {" "}
              <span className="font-medium">{project.name}</span>
              {" "}
              and all related messages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteProject.isPending}>
              Cancel
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteProject.isPending}
              onClick={() => deleteProject.mutate({ id: projectId })}
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
