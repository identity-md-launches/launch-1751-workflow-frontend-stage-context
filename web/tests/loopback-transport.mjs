// Optional adapter for this worker's Chrome policy, used by the unmodified
// pinned taste probe. Fetches only loopback requests through Node and returns
// their exact HTTP response bytes. Does not change the DOM or probe results.
import { chromium } from "playwright";
const launch = chromium.launch.bind(chromium);
chromium.launch = async (options) => {
  const browser = await launch(options);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    const context = await newContext(options);
    const newPage = context.newPage.bind(context);
    context.newPage = async () => {
      const page = await newPage();
      const route = page.route.bind(page);
      page.route = (pattern, handler, options) =>
        route(
          pattern,
          async (requestRoute, request) => {
            const url = new URL(request.url());
            if (url.hostname === "127.0.0.1" && url.protocol === "http:") {
              const result = await fetch(url, {
                method: request.method(),
                body: request.postDataBuffer() ?? undefined,
              });
              return requestRoute.fulfill({
                status: result.status,
                headers: Object.fromEntries(result.headers),
                body: Buffer.from(await result.arrayBuffer()),
              });
            }
            return handler(requestRoute, request);
          },
          options,
        );
      return page;
    };
    return context;
  };
  return browser;
};
