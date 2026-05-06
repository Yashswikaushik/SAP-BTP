import { CredentialType, Prisma } from '@prisma/client';
import axios from 'axios';
import { prisma } from '../db/prisma.js';
import { AppError } from '../http/errors.js';
import { decryptSecret, encryptSecret } from './crypto.js';

export type CredentialInput = {
  tenantId: string;
  provider: string;
  type: CredentialType;
  accessToken?: string | undefined;
  refreshToken?: string | undefined;
  apiKey?: string | undefined;
  expiresAt?: Date | undefined;
  metadata?: Prisma.InputJsonValue | undefined;
};

export type AuthHeaderStrategy = 'authorization-bearer' | 'x-api-key' | 'none';

export class TokenManager {
  async upsertCredential(input: CredentialInput) {
    const createData: Prisma.CredentialUncheckedCreateInput = {
      tenantId: input.tenantId,
      provider: input.provider,
      type: input.type,
      encryptedAccessToken: input.accessToken ? encryptSecret(input.accessToken) : null,
      encryptedRefreshToken: input.refreshToken ? encryptSecret(input.refreshToken) : null,
      encryptedApiKey: input.apiKey ? encryptSecret(input.apiKey) : null,
      expiresAt: input.expiresAt ?? null,
      metadata: input.metadata ?? Prisma.JsonNull
    };
    const updateData: Prisma.CredentialUncheckedUpdateInput = { type: input.type };
    if (input.accessToken) updateData.encryptedAccessToken = encryptSecret(input.accessToken);
    if (input.refreshToken) updateData.encryptedRefreshToken = encryptSecret(input.refreshToken);
    if (input.apiKey) updateData.encryptedApiKey = encryptSecret(input.apiKey);
    if (input.expiresAt) updateData.expiresAt = input.expiresAt;
    if (input.metadata) updateData.metadata = input.metadata;

    return prisma.credential.upsert({
      where: { tenantId_provider: { tenantId: input.tenantId, provider: input.provider } },
      create: createData,
      update: updateData
    });
  }

  async getSecret(tenantId: string, provider: string): Promise<string> {
    const credential = await prisma.credential.findUnique({ where: { tenantId_provider: { tenantId, provider } } });
    if (!credential) throw new AppError(404, `Credential not found for ${provider}`, 'CREDENTIAL_NOT_FOUND');
    if (credential.encryptedAccessToken) return decryptSecret(credential.encryptedAccessToken);
    if (credential.encryptedApiKey) return decryptSecret(credential.encryptedApiKey);
    throw new AppError(400, `Credential ${provider} has no usable secret`, 'CREDENTIAL_INVALID');
  }

  async getAuthHeader(tenantId: string, provider: string, strategy: AuthHeaderStrategy = 'authorization-bearer'): Promise<Record<string, string>> {
    if (strategy === 'none') return {};
    const secret = await this.getSecret(tenantId, provider);
    if (strategy === 'x-api-key') return { 'x-api-key': secret };
    return { Authorization: `Bearer ${secret}` };
  }

  async refreshOAuthIfNeeded(tenantId: string, provider: string): Promise<void> {
    const credential = await prisma.credential.findUnique({ where: { tenantId_provider: { tenantId, provider } } });
    if (!credential?.encryptedRefreshToken || !credential.expiresAt || credential.expiresAt.getTime() - Date.now() > 60_000) return;
    const metadata = credential.metadata as Record<string, string> | null;
    if (!metadata?.tokenUrl || !metadata.clientId || !metadata.clientSecret) {
      throw new AppError(400, `OAuth metadata missing for ${provider}`, 'OAUTH_METADATA_MISSING');
    }
    const { data } = await axios.post(metadata.tokenUrl, new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: decryptSecret(credential.encryptedRefreshToken),
      client_id: metadata.clientId,
      client_secret: metadata.clientSecret
    }));
    await this.upsertCredential({
      tenantId,
      provider,
      type: 'OAUTH2',
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? decryptSecret(credential.encryptedRefreshToken),
      expiresAt: data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000) : undefined,
      metadata: credential.metadata as Prisma.InputJsonValue
    });
  }
}

export const tokenManager = new TokenManager();
