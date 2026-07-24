import { randomBytes } from "crypto";
import AppError from "../../errors/AppError";
import { hashApiKeySecret } from "../domain/PublicApiKey";
import ApiCredential from "../persistence/models/ApiCredential";

export interface IssueApiCredentialInput {
  companyId: number;
  name: string;
  scopes: string[];
  connectionIds: number[];
}

interface ApiCredentialRepository {
  create: (data: Record<string, unknown>) => Promise<any>;
}

const defaultRepository: ApiCredentialRepository = {
  create: data => ApiCredential.create(data as any)
};

const createTokenPart = (): string => randomBytes(24).toString("hex");

class ApiCredentialService {
  constructor(
    private readonly repository = defaultRepository,
    private readonly getPepper = () => process.env.API_KEY_PEPPER || "",
    private readonly tokenPart = createTokenPart
  ) {}

  async issue(input: IssueApiCredentialInput): Promise<{ credential: any; apiKey: string }> {
    const pepper = this.getPepper();
    if (!pepper) {
      throw new AppError("API_KEY_PEPPER nao configurado", 500);
    }
    if (!input.name.trim() || input.scopes.length === 0) {
      throw new AppError("Nome e ao menos um escopo sao obrigatorios", 400);
    }

    const tokenId = this.tokenPart();
    const secret = this.tokenPart();
    const credential = await this.repository.create({
      companyId: input.companyId,
      name: input.name.trim(),
      tokenId,
      secretHash: hashApiKeySecret(secret, pepper),
      scopes: input.scopes,
      connectionIds: input.connectionIds
    });

    return { credential, apiKey: `dch_live_${tokenId}.${secret}` };
  }
}

export default ApiCredentialService;
