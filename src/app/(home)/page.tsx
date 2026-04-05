import Image from "next/image";

import { ProjectForm } from "@/modules/home/ui/components/project-form";
import { ProjectsList } from "@/modules/home/ui/components/projects-list";

const Page = () => {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-y-8">
      <section className="relative pt-8 md:pt-14">
        <div className="glass-panel rounded-3xl border-border/70 px-6 py-10 md:px-10 md:py-14">
          <div className="mx-auto flex max-w-4xl flex-col items-center gap-y-5">
            <div className="inline-flex items-center gap-x-2 rounded-full border border-border/70 bg-background/70 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <Image
                src="/logo.svg"
                alt="Vibe"
                width={16}
                height={16}
              />
              AI Website Studio
            </div>
            <h1 className="hero-title max-w-3xl text-center font-semibold">
              Ship polished products with conversational building.
            </h1>
            <p className="max-w-2xl text-center text-base text-muted-foreground md:text-lg">
              Vibe turns your prompts into complete interfaces, components, and flows. Describe what you need and iterate in real time.
            </p>
          </div>
          <div className="mx-auto mt-8 w-full max-w-3xl md:mt-10">
            <ProjectForm />
          </div>
        </div>
      </section>
      <section className="pb-6">
        <ProjectsList />
      </section>
    </div>
  );
};
 
export default Page;
