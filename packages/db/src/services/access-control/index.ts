// Resource types
export const RESOURCE_TYPES = ['artifact', 'node', 'project', 'article'] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

// ACL Service exports
export { AclService, DiscoveryService } from './acl-service';
export type { ResourceRef, AccessCheckResult, AclRecord } from './acl-service';

// Access Token Service exports
export { AccessTokenService } from './access-token-service';
export type { 
  CreateTokenParams, 
  AccessTokenInfo 
} from './access-token-service';
