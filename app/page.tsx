import ReviterStudio from "./ReviterStudio";
import { ErrorBoundary } from "./studio/ErrorBoundary.tsx";

export default function Home() {
  return (
    <ErrorBoundary>
      <ReviterStudio />
    </ErrorBoundary>
  );
}
