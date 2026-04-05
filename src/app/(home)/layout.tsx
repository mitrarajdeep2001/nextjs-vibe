import { Navbar } from "@/modules/home/ui/components/navbar";

interface Props {
  children: React.ReactNode;
};

const Layout = ({ children }: Props) => {
  return ( 
    <main className="app-shell flex min-h-screen flex-col">
      <Navbar />
      <div className="pointer-events-none absolute -top-32 -left-10 -z-10 size-96 rounded-full bg-primary/20 blur-[120px]" />
      <div className="pointer-events-none absolute top-40 -right-16 -z-10 size-[28rem] rounded-full bg-accent/45 blur-[120px]" />
      <div className="flex-1 flex flex-col px-4 pb-4 pt-20">
        {children}
      </div>
    </main>
  );
};
 
export default Layout;
