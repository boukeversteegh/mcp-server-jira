/**
 * Minimal client for the Atlassian platform GraphQL gateway (`<JIRA_HOST>/gateway/api/graphql`).
 * Some data has no REST endpoint at all — the notification feed behind the bell icon is one —
 * and the gateway accepts the same email + API token basic auth as the REST API.
 */
export type GraphqlClient = (query: string, variables?: Record<string, unknown>) => Promise<any>;
/**
 * The site's ARI (`ari:cloud:jira::site/<cloudId>`), which the notification fields take as
 * `collabContextRoutingAri`. The cloud ID comes from the site's public `/_edge/tenant_info`.
 * Cached for the process lifetime; a failed lookup is retried on the next call.
 */
export declare function jiraSiteAri(): Promise<string>;
export declare function atlassianGraphql(): GraphqlClient;
