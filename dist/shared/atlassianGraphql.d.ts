/**
 * Minimal client for the Atlassian platform GraphQL gateway (`<JIRA_HOST>/gateway/api/graphql`).
 * Some data has no REST endpoint at all — the notification feed behind the bell icon is one —
 * and the gateway accepts the same email + API token basic auth as the REST API.
 */
export type GraphqlClient = (query: string, variables?: Record<string, unknown>) => Promise<any>;
export declare function atlassianGraphql(): GraphqlClient;
