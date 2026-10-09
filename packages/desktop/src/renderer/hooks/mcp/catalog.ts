import { mcpService } from '@/common/adapter/ipcBridge';
import {
  BUILTIN_IMAGE_GEN_ID,
  BUILTIN_IMAGE_GEN_NAME,
  type IMcpServer,
  type IMcpServerTransport,
  type ISessionMcpServer,
} from '@/common/config/storage';
import { getClientBusinessSetting } from '@/renderer/services/clientBusinessSettings';

type BackendMcpTransport = Exclude<IMcpServerTransport, { type: 'streamable_http' }>;

type BackendMcpPayload = {
  name: string;
  description?: string;
  transport: BackendMcpTransport;
  original_json: string;
  builtin?: boolean;
};

const isBuiltinServer = (server: IMcpServer) => server.builtin === true;

/**
 * The built-in image generation row. It is not an MCP server the user manages: the image model is a
 * server-wide setting and the backend adds the tool to every session itself, so this per-user row (the
 * desktop still creates it) stays out of the MCP list and out of what a new conversation sends.
 */
export const isBuiltinImageGenServer = (server: Pick<IMcpServer, 'id' | 'name' | 'builtin'>): boolean =>
  server.builtin === true && (server.id === BUILTIN_IMAGE_GEN_ID || server.name === BUILTIN_IMAGE_GEN_NAME);

const normalizeServerName = (name: string) => name.trim().toLowerCase();

const getCatalogServerKey = (server: Pick<IMcpServer, 'id' | 'name' | 'builtin'>) => {
  const normalizedName = normalizeServerName(server.name);
  if (server.builtin === true) {
    return `builtin:${normalizedName || server.id}`;
  }
  return `user:${normalizedName || server.id}`;
};

const dedupeServers = (servers: IMcpServer[]) => {
  const seen = new Set<string>();
  const deduped: IMcpServer[] = [];

  for (const server of servers) {
    const key = getCatalogServerKey(server);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(server);
  }

  return deduped;
};

const normalizeTransportForBackend = (transport: IMcpServerTransport): BackendMcpTransport => {
  if (transport.type === 'streamable_http') {
    return {
      type: 'http',
      url: transport.url,
      headers: transport.headers,
    };
  }
  return transport;
};

export const toBackendMcpPayload = (
  server: Pick<IMcpServer, 'name' | 'description' | 'transport' | 'original_json' | 'builtin'>
): BackendMcpPayload => ({
  name: server.name,
  description: server.description,
  transport: normalizeTransportForBackend(server.transport),
  original_json: server.original_json || '{}',
  builtin: Boolean(server.builtin),
});

export const toSessionMcpServer = (server: Pick<IMcpServer, 'id' | 'name' | 'transport'>): ISessionMcpServer => ({
  id: server.id,
  name: server.name,
  transport: server.transport,
});

export const ensureBackendMcpCatalog = async (): Promise<{
  userServers: IMcpServer[];
  builtinServers: IMcpServer[];
  allServers: IMcpServer[];
}> => {
  const localServers = ((await getClientBusinessSetting('mcp.config').catch((): IMcpServer[] => [])) ||
    []) as IMcpServer[];
  const builtinServers = dedupeServers(localServers.filter(isBuiltinServer));
  const userServers = dedupeServers(await mcpService.listServers.invoke());

  const allServers = dedupeServers([...userServers, ...builtinServers]);

  return {
    userServers,
    builtinServers,
    allServers,
  };
};
