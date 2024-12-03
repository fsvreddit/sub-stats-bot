import { isMilestoneCrossed, nextMilestone } from "./subscriberCount.js";

test("Teens milestone not respected", () => {
    const result = isMilestoneCrossed(74, 83);
    expect(result).toBeUndefined();
});

test("Fifties milestone not respected", () => {
    const result = isMilestoneCrossed(140, 160);
    expect(result).toBeUndefined();
});

test("Low Hundreds milestone crossed", () => {
    const result = isMilestoneCrossed(156, 204);
    expect(result).toEqual(200);
});

test("High Hundreds milestone crossed", () => {
    const result = isMilestoneCrossed(494, 506);
    expect(result).toEqual(500);
});

test("Thousands milestone crossed", () => {
    const result = isMilestoneCrossed(1485, 1602);
    expect(result).toEqual(1500);
});

test("Thousands milestone not crossed", () => {
    const result = isMilestoneCrossed(1385, 1402);
    expect(result).toBeUndefined();
});

test("Million milestone crossed", () => {
    const result = isMilestoneCrossed(999999, 1000001);
    expect(result).toEqual(1000000);
});

test("Millions milestone not crossed", () => {
    const result = isMilestoneCrossed(1234567, 1400001);
    expect(result).toBeUndefined();
});

test("Large increase returns highest milestone", () => {
    const result = isMilestoneCrossed(450, 1600);
    expect(result).toEqual(1500);
});

test("Hundreds milestone", () => {
    const result = nextMilestone(829);
    expect(result).toEqual(900);
});

test("Thousands milestone", () => {
    const result = nextMilestone(1300);
    expect(result).toEqual(1500);
});

test("Thousands milestone 2", () => {
    const result = nextMilestone(1600);
    expect(result).toEqual(2000);
});

test("Tens of thousands milestone", () => {
    const result = nextMilestone(85829);
    expect(result).toEqual(90000);
});

test("Tens of thousands milestone 2", () => {
    const result = nextMilestone(93351);
    expect(result).toEqual(95000);
});

test("Hundreds of thousands milestone", () => {
    const result = nextMilestone(104329);
    expect(result).toEqual(150000);
});

test("Hundreds of thousands milestone 2", () => {
    const result = nextMilestone(173216);
    expect(result).toEqual(200000);
});
