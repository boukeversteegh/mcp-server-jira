/**
 * Minimal client for the Atlassian platform GraphQL gateway (`<JIRA_HOST>/gateway/api/graphql`).
 * Some data has no REST endpoint at all — the notification feed behind the bell icon is one —
 * and the gateway accepts the same email + API token basic auth as the REST API.
 */
export type GraphqlClient = (
  query: string,
  variables?: Record<string, unknown>,
) => Promise<any>;

export function atlassianGraphql(): GraphqlClient {
  const { JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
  const endpoint = `${(JIRA_HOST ?? "").replace(/\/+$/, "")}/gateway/api/graphql`;
  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString(
    "base64",
  );

  return async (query, variables) => {
    // The gateway warns on anonymous operations, so the operation name is taken from the query.
    const operationName = /^\s*(?:query|mutation)\s+(\w+)/.exec(query)?.[1];
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        // The notification fields are flagged experimental; without this header they may be refused.
        "X-ExperimentalApi": "true",
      },
      body: JSON.stringify({ query, variables, operationName }),
    });

    const text = await response.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(
        `GraphQL gateway returned ${response.status} ${response.statusText}: ${text.slice(0, 500)}`,
      );
    }

    if (!body.data && body.errors?.length) {
      throw new Error(
        `GraphQL error: ${body.errors.map((e: any) => e.message).join("; ")}`,
      );
    }
    if (!response.ok && !body.data) {
      throw new Error(
        `GraphQL gateway returned ${response.status} ${response.statusText}`,
      );
    }
    return body.data;
  };
}
