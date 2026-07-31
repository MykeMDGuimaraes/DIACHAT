import { v4 as uuidv4 } from "uuid";
import AppError from "../../errors/AppError";
import MessageTemplate from "../persistence/models/MessageTemplate";
export type TemplateVariable = { name: string; required?: boolean; defaultValue?: string };
export const renderInternalTemplate = (content: string, definitions: TemplateVariable[], values: Record<string, unknown> = {}): string => {
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(content)) throw new AppError("VALIDATION_ERROR", 400);
  const known = new Map(definitions.map(item => [item.name, item]));
  return content.replace(/{{\s*([A-Za-z][A-Za-z0-9_]*)\s*}}/g, (_token, name) => {
    const definition = known.get(name); const value = values[name] ?? definition?.defaultValue;
    if (!definition || (definition.required !== false && (value === undefined || value === null || value === ""))) throw new AppError("VALIDATION_ERROR", 400);
    const text = String(value ?? ""); if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) throw new AppError("VALIDATION_ERROR", 400); return text;
  });
};
class InternalTemplateService {
  async list(companyId: number) { return MessageTemplate.findAll({ where: { companyId }, order: [["updatedAt", "DESC"]] }); }
  async create(companyId: number, input: any) { return MessageTemplate.create({ companyId, publicId: uuidv4(), name: String(input.name || "").trim(), content: String(input.content || ""), variables: Array.isArray(input.variables) ? input.variables : [], createdBy: input.createdBy } as any); }
  async render(companyId: number, id: string, variables: Record<string, unknown>) { const item = await MessageTemplate.findOne({ where: { companyId, publicId: id, active: true } }); if (!item) throw new AppError("Internal template nao encontrado", 404); return { text: renderInternalTemplate(item.content, item.variables || [], variables), internalTemplateId: item.publicId, version: item.version }; }
}
export default InternalTemplateService;
