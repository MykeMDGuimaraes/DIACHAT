declare namespace Express {
  export interface Request {
    user: { id: string; profile: string; companyId: number };
    apiCredential?: {
      id: string;
      companyId: number;
      scopes: string[];
      connectionIds: number[];
    };
  }
}
