// Enable fetch mocking
import fetchMock from "jest-fetch-mock";
fetchMock.enableMocks();

// Required by React 19 when using act with concurrent rendering.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Optional: silence console.error in tests unless explicitly checking for it
const originalError = console.error;
beforeEach(() => {
  fetchMock.resetMocks();
});

afterAll(() => {
  console.error = originalError;
});
