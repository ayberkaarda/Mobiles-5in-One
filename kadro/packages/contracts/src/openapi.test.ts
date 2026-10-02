/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

import committed from '../../../docs/api/openapi.json?raw';
import {
  AUTH_CLIENT_HEADER,
  CSRF_HEADER,
  ENDPOINT_LIST,
  endpointActions,
  endpointErrorCodes,
  ERROR_CODES,
  ERROR_STATUS,
  toOpenApiPath,
} from './index.js';
import {
  buildOpenApiDocument,
  type JsonObject,
  type JsonValue,
  serializeOpenApiDocument,
  SESSION_COOKIE_NAME,
} from './openapi.js';

const document = buildOpenApiDocument();

function object(value: JsonValue | undefined): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('expected a JSON object');
  }
  return value;
}

function walk(value: JsonValue, visit: (node: JsonObject, path: string) => void, path = '#'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visit, `${path}/${index}`));
  } else if (typeof value === 'object' && value !== null) {
    visit(value, path);
    for (const [key, item] of Object.entries(value)) {
      walk(item, visit, `${path}/${key}`);
    }
  }
}

function operationOf(method: string, path: string): JsonObject {
  return object(object(object(document.paths)[toOpenApiPath(path)])[method.toLowerCase()]);
}

describe('committed document', () => {
  it('docs/api/openapi.json is up to date (run `pnpm --filter @kadro/contracts openapi`)', () => {
    expect(committed.replace(/\r\n/g, '\n')).toBe(serializeOpenApiDocument(document));
  });

  it('serializes deterministically', () => {
    expect(serializeOpenApiDocument(buildOpenApiDocument())).toBe(
      serializeOpenApiDocument(document),
    );
  });
});

describe('document structure', () => {
  it('is OpenAPI 3.1 with the JSON Schema 2020-12 dialect', () => {
    expect(document.openapi).toBe('3.1.0');
    expect(document.jsonSchemaDialect).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(object(document.info).version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('has one operation per registry endpoint with the registry metadata', () => {
    const ids: string[] = [];
    for (const endpoint of ENDPOINT_LIST) {
      const operation = operationOf(endpoint.method, endpoint.path);
      ids.push(String(operation.operationId));
      expect(operation.operationId).toBe(endpoint.id);
      expect(operation['x-kadro-auth']).toBe(endpoint.auth);
      expect(operation['x-kadro-client']).toBe(endpoint.client);
      expect(operation['x-kadro-email-verified']).toBe(endpoint.emailVerified);
      expect(operation['x-kadro-step-up']).toBe(endpoint.stepUp === true);
      const policy = operation['x-kadro-policy-action'];
      const actions = endpointActions(endpoint);
      if (typeof policy === 'string') {
        expect([policy]).toEqual(actions);
      } else if (policy !== null) {
        expect(Object.values(object(object(policy).actions)).sort()).toEqual(
          Object.values('selectBy' in endpoint.policy ? endpoint.policy.actions : {}).sort(),
        );
      } else {
        expect(actions).toEqual([]);
      }
      const rateLimit = operation['x-kadro-rate-limit'];
      expect(rateLimit === null ? null : object(rateLimit).group).toBe(endpoint.rateLimit);
    }
    expect(new Set(ids).size).toBe(ENDPOINT_LIST.length);
    const operationCount = Object.values(object(document.paths)).reduce<number>(
      (count, item) => count + Object.keys(object(item)).length,
      0,
    );
    expect(operationCount).toBe(ENDPOINT_LIST.length);
  });

  it('documents the x-kadro-client header on every operation that requires it', () => {
    const parameter = object(object(object(document.components).parameters).KadroClient);
    expect(parameter.name).toBe(AUTH_CLIENT_HEADER);
    expect(parameter.in).toBe('header');
    expect(object(parameter.schema).enum).toEqual(['mobile', 'web']);
    for (const endpoint of ENDPOINT_LIST) {
      const parameters = (operationOf(endpoint.method, endpoint.path).parameters ??
        []) as JsonValue[];
      const hasHeader = parameters.some(
        (item) => object(item).$ref === '#/components/parameters/KadroClient',
      );
      expect(hasHeader, endpoint.id).toBe(endpoint.client === 'required');
    }
  });

  it('declares bearer, session cookie and CSRF security schemes', () => {
    const schemes = object(object(document.components).securitySchemes);
    expect(object(schemes.bearerAuth)).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(object(schemes.sessionCookie)).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
      name: SESSION_COOKIE_NAME,
    });
    expect(object(schemes.csrfToken)).toMatchObject({
      type: 'apiKey',
      in: 'header',
      name: CSRF_HEADER,
    });
    expect(object(schemes.webhookSecret)).toMatchObject({
      type: 'apiKey',
      in: 'header',
      name: 'Authorization',
    });
    for (const endpoint of ENDPOINT_LIST) {
      const security = operationOf(endpoint.method, endpoint.path).security as JsonValue[];
      if (endpoint.tag === 'webhooks') {
        expect(security, endpoint.id).toEqual([{ webhookSecret: [] }]);
        continue;
      }
      if (endpoint.auth === 'none') {
        expect(security, endpoint.id).toEqual([]);
        continue;
      }
      expect(security).toContainEqual({ bearerAuth: [] });
      const web =
        endpoint.method === 'GET' ? { sessionCookie: [] } : { sessionCookie: [], csrfToken: [] };
      expect(security).toContainEqual(web);
      expect(security.some((item) => Object.keys(object(item)).length === 0)).toBe(
        endpoint.auth === 'optional',
      );
    }
  });

  it('answers every error with problem details restricted to the endpoint codes', () => {
    const problem = object(object(object(document.components).schemas).Problem);
    expect(object(object(problem.properties).code).enum).toEqual([...ERROR_CODES]);
    for (const endpoint of ENDPOINT_LIST) {
      const responses = object(operationOf(endpoint.method, endpoint.path).responses);
      expect(Object.keys(responses)).toContain(String(endpoint.response.status));
      const documented: string[] = [];
      for (const [status, response] of Object.entries(responses)) {
        if (Number(status) < 400) {
          continue;
        }
        const content = object(object(object(response).content)['application/problem+json']);
        const [base, narrowed] = object(content.schema).allOf as JsonObject[];
        expect(base?.$ref).toBe('#/components/schemas/Problem');
        const codes = object(object(narrowed?.properties).code).enum as string[];
        for (const code of codes) {
          expect(ERROR_STATUS[code as keyof typeof ERROR_STATUS]).toBe(Number(status));
        }
        documented.push(...codes);
      }
      expect(documented.sort()).toEqual(endpointErrorCodes(endpoint).sort());
    }
  });

  it('resolves every $ref', () => {
    walk(document, (node, path) => {
      const ref = node.$ref;
      if (typeof ref !== 'string') {
        return;
      }
      const target = ref
        .replace(/^#\//, '')
        .split('/')
        .reduce<JsonValue | undefined>(
          (current, segment) =>
            typeof current === 'object' && current !== null && !Array.isArray(current)
              ? current[segment]
              : undefined,
          document,
        );
      expect(target, `${path} → ${ref}`).toBeDefined();
    });
  });

  it('keeps every object schema closed and leaks no secret-bearing field', () => {
    const forbidden =
      /^(password_?hash|passwordHash|token_?hash|tokenHash|code_?hash|codeHash|totp_?secret|totpSecretEnc|apple_?sub|appleSub|google_?sub|googleSub|ownerId|createdBy|avatarKey|badgeKey)$/;
    walk(object(object(document.components).schemas), (node, path) => {
      if (node.type === 'object' && node.properties !== undefined) {
        // The RevenueCat event is the one deliberately open object: the provider adds fields
        // without notice, and only the listed ones are read (ADR-0063).
        expect(node.additionalProperties, path).toEqual(path === '#/RevenueCatEvent' ? {} : false);
        for (const key of Object.keys(object(node.properties))) {
          expect(forbidden.test(key), `${path}.${key}`).toBe(false);
        }
      }
    });
  });

  it('exposes email only in the caller’s own profile', () => {
    const schemas = object(object(document.components).schemas);
    const withEmail = Object.entries(schemas)
      .filter(([, schema]) => JSON.stringify(schema).includes('"email"'))
      .map(([name]) => name)
      .sort();
    expect(withEmail).toEqual(
      ['ForgotPasswordRequest', 'LoginRequest', 'Me', 'RegisterRequest'].sort(),
    );
  });
});

describe('serializer', () => {
  it('keeps short primitive arrays inline and breaks long ones like Prettier', () => {
    const short = serializeOpenApiDocument({ required: ['a', 'b'] });
    expect(short).toBe('{\n  "required": ["a", "b"]\n}\n');
    const long = serializeOpenApiDocument({
      items: Array.from({ length: 12 }, (_, i) => `value-${i}`),
    });
    expect(long.split('\n').length).toBeGreaterThan(12);
    expect(serializeOpenApiDocument({ empty: [], none: {} })).toBe(
      '{\n  "empty": [],\n  "none": {}\n}\n',
    );
  });
});
