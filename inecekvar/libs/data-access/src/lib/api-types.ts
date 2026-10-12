import type { ApiComponents, ApiOperations, ApiPaths } from '@inecekvar/domain';

/** Schemas of `docs/api/openapi.json`, through the types derived into `libs/domain`. */
export type Schemas = ApiComponents['schemas'];

/** Every path of the contract without the `/v1` prefix (the prefix is part of the base URL). */
export type ApiPathTemplate = {
  [K in keyof ApiPaths]: K extends `/v1${infer P}` ? P : never;
}[keyof ApiPaths];

/** Names of the `{placeholders}` in a path template. */
export type PathParamNames<T extends string> = T extends `${string}{${infer Name}}${infer Rest}`
  ? Name | PathParamNames<Rest>
  : never;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type QueryOf<Op extends keyof ApiOperations> = NonNullable<
  ApiOperations[Op]['parameters']['query']
>;

export type City = Schemas['CityOut'];
/** The city dataset; its inner shape is versioned by `pack_version` and parsed by the pack layer. */
export type CityPack = Record<string, unknown>;
export type LineListItem = Schemas['LineListOut'];
export type LineDetail = Schemas['LineOut'];
export type LineVersion = Schemas['VersionOut'];
export type StopDetail = Schemas['StopDetail'];
export type StopSummary = Schemas['StopOut'];
export type PlanRequest = Schemas['PlanInput'];
export type PlanResult = Schemas['PlanOutput'];
export type Me = Schemas['MeOut'];
export type UserRole = Schemas['UserRole'];
export type Favorite = Schemas['FavoriteOut'];
export type Edit = Schemas['EditOut'];
export type EditProposal =
  | Schemas['NewLine']
  | Schemas['UpdateLine']
  | Schemas['NewStop']
  | Schemas['UpdateStop']
  | Schemas['FareUpdate']
  | Schemas['Retire'];
export type TraceUpload = Schemas['TraceInput'];
export type TraceCreated = Schemas['TraceCreated'];
export type Trace = Schemas['TraceOut'];
export type PresignRequest = Schemas['PresignInput'];
export type PresignedUpload = Schemas['PresignOut'];
export type AuthMode = Schemas['LoginIn']['mode'];
export type CookieSignIn = Schemas['CookieOut'];
export type BearerSignIn = Schemas['BearerOut'];
export type SignInResponse = CookieSignIn | BearerSignIn;
export type RefreshResponse = Schemas['RefreshOut'];
export type CsrfResponse = Schemas['CsrfOut'];
export type StatusResponse = Schemas['StatusOut'];

export type LineQuery = QueryOf<'list_lines_v1_lines_get'>;
export type NearStopsQuery = QueryOf<'near_stops_v1_stops_near_get'>;
export type PageQuery = QueryOf<'list_edits_v1_edits_get'>;
