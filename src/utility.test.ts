import { numberWithSign } from "./utility.js";

test("Positive number", () => {
    const result = numberWithSign(1423);
    expect(result).toEqual("+1,423");
});

test("Negative number", () => {
    const result = numberWithSign(-1423);
    expect(result).toEqual("-1,423");
});
