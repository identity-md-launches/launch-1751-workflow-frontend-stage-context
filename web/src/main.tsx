import React from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadRuntime } from "./config";
import { App } from "./App";
import "./style.css";

const root = createRoot(document.getElementById("root")!);
loadRuntime()
  .then((runtime) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
    });
    root.render(
      <React.StrictMode>
        <WagmiProvider config={runtime.wallets}>
          <QueryClientProvider client={queryClient}>
            <App r={runtime} />
          </QueryClientProvider>
        </WagmiProvider>
      </React.StrictMode>,
    );
  })
  .catch((error) =>
    root.render(
      <main className="boot-error">
        <img src="./favicon.svg" width="48" height="48" alt="" />
        <h1>Rekt Blitz</h1>
        <h2>Configuration unavailable</h2>
        <p role="alert">
          {error instanceof Error
            ? error.message
            : "The deployment could not be loaded."}
        </p>
        <button onClick={() => location.reload()}>Reload app</button>
      </main>,
    ),
  );
