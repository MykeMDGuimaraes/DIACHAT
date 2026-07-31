import AppError from "../../../errors/AppError";
import { renderInternalTemplate } from "../InternalTemplateService";

describe("renderInternalTemplate", () => {
  const variables = [{ name: "name", required: true }, { name: "company", required: false, defaultValue: "DIA" }];
  it("renders values and defaults without interpreting HTML", () => {
    expect(renderInternalTemplate("Ola {{name}}, {{company}}", variables, { name: "<Marcos>" })).toBe("Ola <Marcos>, DIA");
  });
  it("does not accept missing required variables or control characters", () => {
    expect(() => renderInternalTemplate("Ola {{name}}", variables, {})).toThrow(AppError);
    expect(() => renderInternalTemplate("x\u0000", variables, { name: "ok" })).toThrow(AppError);
  });
});
