import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CloudDeploy",
  description: "Manage application deployments on a shared Kubernetes cluster.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
