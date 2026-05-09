import { describe, expect, it } from "vitest";
import { HttpError, readJsonBody } from "./http";

describe("HTTP helpers", () => {
  it("maps malformed JSON request bodies to a 400 error", () => {
    expect(() => readJsonBody({ body: "{bad json" })).toThrow(HttpError);

    try {
      readJsonBody({ body: "{bad json" });
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).statusCode).toBe(400);
      expect((error as HttpError).message).toBe("Request body must be valid JSON.");
    }
  });
});
