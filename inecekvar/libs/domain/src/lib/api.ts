// API types derived from docs/api/openapi.json by libs/domain/scripts/build-api-types.mjs.
// Do not edit by hand: change the API, write the contract, then run the script.
export type paths = {
  '/v1/admin/audit-logs': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List Audit Logs */
    get: operations['list_audit_logs_v1_admin_audit_logs_get'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/admin/exports/{city}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Create Export */
    post: operations['create_export_v1_admin_exports__city__post'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/admin/users': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List Users */
    get: operations['list_users_v1_admin_users_get'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/admin/users/{identity}/role': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    /** Change Role */
    patch: operations['change_role_v1_admin_users__identity__role_patch'];
    trace?: never;
  };
  '/v1/auth/csrf': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Csrf */
    post: operations['csrf_v1_auth_csrf_post'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/auth/login': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Login */
    post: operations['login_v1_auth_login_post'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/auth/logout': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Logout */
    post: operations['logout_v1_auth_logout_post'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/auth/logout-all': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Logout All */
    post: operations['logout_all_v1_auth_logout_all_post'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/auth/magic-link': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Magic Link */
    post: operations['magic_link_v1_auth_magic_link_post'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/auth/magic-link/verify': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Magic Link Verify */
    post: operations['magic_link_verify_v1_auth_magic_link_verify_post'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/auth/refresh': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Refresh */
    post: operations['refresh_v1_auth_refresh_post'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/auth/register': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Register */
    post: operations['register_v1_auth_register_post'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/auth/step-up': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Step Up */
    post: operations['step_up_v1_auth_step_up_post'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/cities': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List Cities */
    get: operations['list_cities_v1_cities_get'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/cities/{slug}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read City */
    get: operations['read_city_v1_cities__slug__get'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/cities/{slug}/pack': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Download Pack */
    get: operations['download_pack_v1_cities__slug__pack_get'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/cities/{slug}/sitemap': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Sitemap */
    get: operations['sitemap_v1_cities__slug__sitemap_get'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/cities/{slug}/stop-pairs': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Stop Pairs */
    get: operations['stop_pairs_v1_cities__slug__stop_pairs_get'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/cities/{slug}/tiles.pmtiles': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Tiles */
    get: operations['tiles_v1_cities__slug__tiles_pmtiles_get'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/edits': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List Edits */
    get: operations['list_edits_v1_edits_get'];
    put?: never;
    /** Propose Edit */
    post: operations['propose_edit_v1_edits_post'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/edits/{identity}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read Edit */
    get: operations['read_edit_v1_edits__identity__get'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/export/{city}/latest.geojson': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Latest Geojson */
    get: operations['latest_geojson_v1_export__city__latest_geojson_get'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/health': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Health */
    get: operations['health_v1_health_get'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/lines': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List Lines */
    get: operations['list_lines_v1_lines_get'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/lines/{slug}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read Line */
    get: operations['read_line_v1_lines__slug__get'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/lines/{slug}/versions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List Versions */
    get: operations['list_versions_v1_lines__slug__versions_get'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/me': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Me */
    get: operations['me_v1_me_get'];
    put?: never;
    post?: never;
    /** Delete Me */
    delete: operations['delete_me_v1_me_delete'];
    options?: never;
    head?: never;
    /** Patch Me */
    patch: operations['patch_me_v1_me_patch'];
    trace?: never;
  };
  '/v1/me/favorites': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List Favorites */
    get: operations['list_favorites_v1_me_favorites_get'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/me/favorites/{line_id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read Favorite */
    get: operations['read_favorite_v1_me_favorites__line_id__get'];
    /** Put Favorite */
    put: operations['put_favorite_v1_me_favorites__line_id__put'];
    post?: never;
    /** Delete Favorite */
    delete: operations['delete_favorite_v1_me_favorites__line_id__delete'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/me/licence-accept': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Licence Accept */
    post: operations['licence_accept_v1_me_licence_accept_post'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/me/totp': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Status */
    get: operations['status_v1_me_totp_get'];
    put?: never;
    post?: never;
    /** Disable */
    delete: operations['disable_v1_me_totp_delete'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/me/totp/confirm': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Confirm */
    post: operations['confirm_v1_me_totp_confirm_post'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/me/totp/enrol': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Enrol */
    post: operations['enrol_v1_me_totp_enrol_post'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/media/presign': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Presign Photo */
    post: operations['presign_photo_v1_media_presign_post'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/moderation/edits': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Queue */
    get: operations['queue_v1_moderation_edits_get'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/moderation/edits/{identity}/approve': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Approve Edit */
    post: operations['approve_edit_v1_moderation_edits__identity__approve_post'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/moderation/edits/{identity}/reject': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Reject Edit */
    post: operations['reject_edit_v1_moderation_edits__identity__reject_post'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/moderation/lines/{identity}/rollback': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Rollback Line */
    post: operations['rollback_line_v1_moderation_lines__identity__rollback_post'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/plan': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Create Plan */
    post: operations['create_plan_v1_plan_post'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/sitemap': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Sitemap Index */
    get: operations['sitemap_index_v1_sitemap_get'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/stops': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Search Stops */
    get: operations['search_stops_v1_stops_get'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/stops/{slug}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read Stop */
    get: operations['read_stop_v1_stops__slug__get'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/stops/near': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Near Stops */
    get: operations['near_stops_v1_stops_near_get'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/traces': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Upload Trace */
    post: operations['upload_trace_v1_traces_post'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/v1/traces/{identity}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Read Trace */
    get: operations['read_trace_v1_traces__identity__get'];
    put?: never;
    post?: never;
    /** Delete Trace */
    delete: operations['delete_trace_v1_traces__identity__delete'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
};
export type webhooks = Record<string, never>;
export type components = {
  schemas: {
    /** AdminExportOut */
    AdminExportOut: {
      /** City */
      city: string;
      /** Path */
      path: string;
      /**
       * Published At
       * Format: date-time
       */
      published_at: string;
      /** Version */
      version: number;
    };
    /** AdminUserOut */
    AdminUserOut: {
      /**
       * Created At
       * Format: date-time
       */
      created_at: string;
      /** Deactivated At */
      deactivated_at: string | null;
      /** Display Name */
      display_name: string | null;
      /** Email */
      email: string;
      /** Email Verified At */
      email_verified_at: string | null;
      /**
       * Id
       * Format: uuid
       */
      id: string;
      role: components['schemas']['UserRole'];
      /** Totp Enabled */
      totp_enabled: boolean;
    };
    /** AdminUserPage */
    AdminUserPage: {
      /** Items */
      items: components['schemas']['AdminUserOut'][];
      /** Limit */
      limit: number;
      /** Offset */
      offset: number;
      /** Total */
      total: number;
    };
    /** AuditLogOut */
    AuditLogOut: {
      /** Action */
      action: string;
      /** Actor Id */
      actor_id: string | null;
      /**
       * Created At
       * Format: date-time
       */
      created_at: string;
      /** Diff Hash */
      diff_hash: string | null;
      /**
       * Id
       * Format: uuid
       */
      id: string;
      /** Target Id */
      target_id: string | null;
      /** Target Type */
      target_type: string;
    };
    /** AuditLogPage */
    AuditLogPage: {
      /** Items */
      items: components['schemas']['AuditLogOut'][];
      /** Limit */
      limit: number;
      /** Offset */
      offset: number;
      /** Total */
      total: number;
    };
    /** BearerOut */
    BearerOut: {
      /** Access Token */
      access_token: string;
      /**
       * Auth Mode
       * @default bearer
       * @constant
       */
      auth_mode: 'bearer';
      /** Expires In */
      expires_in: number;
      /** Refresh Token */
      refresh_token: string;
      /**
       * Token Type
       * @default Bearer
       * @constant
       */
      token_type: 'Bearer';
      user: components['schemas']['MeOut'];
    };
    /** CityDetailOut */
    CityDetailOut: {
      /** Bbox */
      bbox: number[];
      /** Centroid */
      centroid: number[];
      /** Is Sample */
      is_sample: boolean;
      /** Lastmod */
      lastmod: string | null;
      /** Name */
      name: string;
      /** Pack Version */
      pack_version: number;
      /** Popular Lines */
      popular_lines: components['schemas']['LineSummary'][];
      /** Published Line Count */
      published_line_count: number;
      /** Recently Updated Lines */
      recently_updated_lines: components['schemas']['RecentLineOut'][];
      /** Slug */
      slug: string;
      /** Timezone */
      timezone: string;
    };
    /** CityOut */
    CityOut: {
      /** Bbox */
      bbox: number[];
      /** Centroid */
      centroid: number[];
      /** Is Sample */
      is_sample: boolean;
      /** Name */
      name: string;
      /** Pack Version */
      pack_version: number;
      /** Published Line Count */
      published_line_count: number;
      /** Slug */
      slug: string;
      /** Timezone */
      timezone: string;
    };
    CitySlug: string;
    /** CookieOut */
    CookieOut: {
      /**
       * Auth Mode
       * @default cookie
       * @constant
       */
      auth_mode: 'cookie';
      /** Csrf Token */
      csrf_token: string;
      user: components['schemas']['MeOut'];
    };
    Coordinate: [number, number];
    /** CsrfOut */
    CsrfOut: {
      /** Csrf Token */
      csrf_token: string;
    };
    /** DeleteMeIn */
    DeleteMeIn: {
      /** Password */
      password?: string | null;
    };
    /** EditOut */
    EditOut: {
      /** City */
      city: string;
      /**
       * Created At
       * Format: date-time
       */
      created_at: string;
      /** Diff */
      diff:
        | {
            [key: string]: unknown;
          }
        | unknown[]
        | null;
      /**
       * Id
       * Format: uuid
       */
      id: string;
      /** Kind */
      kind: string;
      /** Payload */
      payload: {
        [key: string]: unknown;
      };
      /** Reason */
      reason: string | null;
      /** Reviewed At */
      reviewed_at: string | null;
      /** State */
      state: string;
    };
    /** EmptyIn */
    EmptyIn: Record<string, never>;
    Fare: number;
    /** FareUpdate */
    FareUpdate: {
      /** Base Version No */
      base_version_no: number;
      fare_minor: components['schemas']['Fare'];
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      kind: 'fare_update';
      /**
       * Line
       * Format: uuid
       */
      line: string;
      /** Photo Id */
      photo_id?: string | null;
    };
    /** FavoriteOut */
    FavoriteOut: {
      /** City */
      city: string;
      /**
       * Line Id
       * Format: uuid
       */
      line_id: string;
      /** Slug */
      slug: string;
    };
    /** GeoJSONLineString */
    GeoJSONLineString: {
      /** Coordinates */
      coordinates: number[][];
      /**
       * Type
       * @constant
       */
      type: 'LineString';
    };
    GeometryInput: components['schemas']['Coordinate'][];
    HailNotes: string;
    /** HealthStatus */
    HealthStatus: {
      /**
       * Status
       * @constant
       */
      status: 'ok';
    };
    Hours: string;
    /** HTTPValidationError */
    HTTPValidationError: {
      /** Detail */
      detail?: components['schemas']['ValidationError'][];
    };
    /** ItineraryOutput */
    ItineraryOutput: {
      /** Estimated Fare Minor */
      estimated_fare_minor: number | null;
      /** Legs */
      legs: (components['schemas']['WalkOutput'] | components['schemas']['RideOutput'])[];
      /** Ride Stops */
      ride_stops: number;
      /** Transfers */
      transfers: number;
      /** Walk M */
      walk_m: number;
    };
    /** LineChanges */
    LineChanges: {
      fare_minor?: components['schemas']['Fare'] | null;
      geometry?: components['schemas']['GeometryInput'] | null;
      /** Geometry Source */
      geometry_source?: 'trace' | null;
      hail_notes?: components['schemas']['HailNotes'] | null;
      hours_text?: components['schemas']['Hours'] | null;
      name?: components['schemas']['Name'] | null;
      payment_methods?: components['schemas']['Payments'] | null;
      stop_ids?: components['schemas']['StopIds'] | null;
      /** Trace Id */
      trace_id?: string | null;
    };
    /** LineListOut */
    LineListOut: {
      /** Code */
      code: string;
      /**
       * Id
       * Format: uuid
       */
      id: string;
      /** Mode */
      mode: string;
      /** Name */
      name: string;
      /** Slug */
      slug: string;
    };
    /**
     * LineMode
     * @enum {string}
     */
    LineMode: 'dolmus' | 'minibus' | 'servis';
    /** LineOut */
    LineOut: {
      /** Code */
      code: string;
      /** Contributor Count */
      contributor_count: number;
      /** Fare Minor */
      fare_minor: number | null;
      /** Fare Updated At */
      fare_updated_at: string | null;
      geometry: components['schemas']['GeoJSONLineString'];
      /** Hail Notes */
      hail_notes: string | null;
      /** Hours Text */
      hours_text: string | null;
      /**
       * Id
       * Format: uuid
       */
      id: string;
      /** Last Verified At */
      last_verified_at: string | null;
      /** Mode */
      mode: string;
      /** Name */
      name: string;
      /** Payment Methods */
      payment_methods: string[];
      /**
       * Published At
       * Format: date-time
       */
      published_at: string;
      /** Slug */
      slug: string;
      /** Status */
      status: string;
      /** Stops */
      stops: components['schemas']['StopOut'][];
      /** Version No */
      version_no: number;
    };
    /** LineSummary */
    LineSummary: {
      /** Code */
      code: string;
      /** Mode */
      mode: string;
      /** Name */
      name: string;
      /** Slug */
      slug: string;
    };
    Location: components['schemas']['Coordinate'];
    /** LoginIn */
    LoginIn: {
      /**
       * Email
       * Format: email
       */
      email: string;
      /**
       * Mode
       * @enum {string}
       */
      mode: 'cookie' | 'bearer';
      /** Password */
      password: string;
    };
    /** MagicLinkIn */
    MagicLinkIn: {
      /**
       * Email
       * Format: email
       */
      email: string;
    };
    /** MeOut */
    MeOut: {
      /**
       * Created At
       * Format: date-time
       */
      created_at: string;
      /** Display Name */
      display_name: string | null;
      /** Email */
      email: string;
      /** Email Verified */
      email_verified: boolean;
      /**
       * Id
       * Format: uuid
       */
      id: string;
      /** Licence Accepted */
      licence_accepted: boolean;
      /** Reputation */
      reputation: number;
      role: components['schemas']['UserRole'];
    };
    Name: string;
    /** NewLine */
    NewLine: {
      city: components['schemas']['CitySlug'];
      /** Code */
      code: string;
      fare_minor?: components['schemas']['Fare'] | null;
      geometry?: components['schemas']['GeometryInput'] | null;
      /** Geometry Source */
      geometry_source?: 'trace' | null;
      hail_notes?: components['schemas']['HailNotes'] | null;
      hours_text?: components['schemas']['Hours'] | null;
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      kind: 'new_line';
      mode: components['schemas']['LineMode'];
      name: components['schemas']['Name'];
      payment_methods?: components['schemas']['Payments'];
      /** Photo Id */
      photo_id?: string | null;
      stop_ids: components['schemas']['StopIds'];
      /** Trace Id */
      trace_id?: string | null;
    };
    /** NewStop */
    NewStop: {
      city: components['schemas']['CitySlug'];
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      kind: 'new_stop';
      location: components['schemas']['Location'];
      name: components['schemas']['Name'];
      /** Photo Id */
      photo_id?: string | null;
      stop_kind: components['schemas']['StopKind'];
    };
    /** PatchMeIn */
    PatchMeIn: {
      /** Display Name */
      display_name: string | null;
    };
    /** @enum {string} */
    Payment: 'nakit' | 'kart' | 'istanbulkart';
    Payments: components['schemas']['Payment'][];
    /** PlanInput */
    PlanInput: {
      /** City */
      city: string;
      from: components['schemas']['PointInput'];
      /**
       * Max Transfers
       * @default 2
       */
      max_transfers: number;
      to: components['schemas']['PointInput'];
    };
    /** PlanOutput */
    PlanOutput: {
      /** City */
      city: string;
      /** Degraded */
      degraded: boolean;
      /** Itineraries */
      itineraries: components['schemas']['ItineraryOutput'][];
    };
    /** PointInput */
    PointInput: {
      /** Lat */
      lat: number;
      /** Lng */
      lng: number;
    };
    /** PresignInput */
    PresignInput: {
      /** Byte Size */
      byte_size: number;
      /**
       * Content Type
       * @enum {string}
       */
      content_type: 'image/jpeg' | 'image/webp';
      /**
       * Kind
       * @enum {string}
       */
      kind: 'fare_table' | 'stop_sign';
    };
    /** PresignOut */
    PresignOut: {
      /** Expires In */
      expires_in: number;
      /** Headers */
      headers: {
        [key: string]: string;
      };
      /**
       * Method
       * @default PUT
       * @constant
       */
      method: 'PUT';
      /**
       * Photo Id
       * Format: uuid
       */
      photo_id: string;
      /** Upload Url */
      upload_url: string;
    };
    /** QueueOut */
    QueueOut: {
      /** Author */
      author: string;
      /** City */
      city: string;
      /**
       * Created At
       * Format: date-time
       */
      created_at: string;
      current_geometry: components['schemas']['GeoJSONLineString'] | null;
      /** Diff */
      diff:
        | {
            [key: string]: unknown;
          }
        | unknown[]
        | null;
      /**
       * Id
       * Format: uuid
       */
      id: string;
      /** Kind */
      kind: string;
      /** Payload */
      payload: {
        [key: string]: unknown;
      };
      proposed_geometry: components['schemas']['GeoJSONLineString'] | null;
      /** Reason */
      reason: string | null;
      /** Reviewed At */
      reviewed_at: string | null;
      /** State */
      state: string;
    };
    /** RecentLineOut */
    RecentLineOut: {
      /** Code */
      code: string;
      /** Mode */
      mode: string;
      /** Name */
      name: string;
      /** Slug */
      slug: string;
      /**
       * Updated At
       * Format: date-time
       */
      updated_at: string;
    };
    /** RefreshIn */
    RefreshIn: {
      /** Refresh Token */
      refresh_token: string;
    };
    /** RefreshOut */
    RefreshOut: {
      /** Access Token */
      access_token: string;
      /** Expires In */
      expires_in: number;
      /** Refresh Token */
      refresh_token: string;
      /**
       * Token Type
       * @default Bearer
       * @constant
       */
      token_type: 'Bearer';
    };
    /** RegisterIn */
    RegisterIn: {
      /** Display Name */
      display_name?: string | null;
      /**
       * Email
       * Format: email
       */
      email: string;
      /**
       * Mode
       * @enum {string}
       */
      mode: 'cookie' | 'bearer';
      /** Password */
      password: string;
    };
    /** RejectInput */
    RejectInput: {
      /** Reason */
      reason: string;
    };
    /** Retire */
    Retire: {
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      kind: 'retire';
      /**
       * Line
       * Format: uuid
       */
      line: string;
      /** Photo Id */
      photo_id?: string | null;
      /** Reason */
      reason: string;
    };
    /** RideOutput */
    RideOutput: {
      alight_stop: components['schemas']['StopOutput'];
      board_stop: components['schemas']['StopOutput'];
      /**
       * Kind
       * @default ride
       * @constant
       */
      kind: 'ride';
      /** Line Code */
      line_code: string;
      /** Line Id */
      line_id: string;
      /** Line Name */
      line_name: string;
      /** Line Slug */
      line_slug: string;
      /** Stop Count */
      stop_count: number;
    };
    /** RoleChangeIn */
    RoleChangeIn: {
      role: components['schemas']['UserRole'];
    };
    /** RollbackInput */
    RollbackInput: {
      /** Version No */
      version_no: number;
    };
    /** SitemapCityOut */
    SitemapCityOut: {
      /** Is Sample */
      is_sample: boolean;
      /**
       * Lastmod
       * Format: date-time
       */
      lastmod: string;
      /** Published Line Count */
      published_line_count: number;
      /** Slug */
      slug: string;
    };
    /** SitemapIndexOut */
    SitemapIndexOut: {
      /** Cities */
      cities: components['schemas']['SitemapCityOut'][];
    };
    /** StatusOut */
    StatusOut: {
      /**
       * Status
       * @enum {string}
       */
      status: 'check_email' | 'deletion_scheduled';
    };
    /** StepUpOut */
    StepUpOut: {
      /**
       * Expires At
       * Format: date-time
       */
      expires_at: string;
      /**
       * Verified At
       * Format: date-time
       */
      verified_at: string;
    };
    /** StopChanges */
    StopChanges: {
      kind?: components['schemas']['StopKind'] | null;
      location?: components['schemas']['Location'] | null;
      name?: components['schemas']['Name'] | null;
    };
    /** StopDetail */
    StopDetail: {
      /**
       * Id
       * Format: uuid
       */
      id: string;
      /** Kind */
      kind: string;
      /** Lines */
      lines: components['schemas']['LineSummary'][];
      /** Location */
      location: number[];
      /** Name */
      name: string;
      /** Slug */
      slug: string;
    };
    StopIds: string[];
    /**
     * StopKind
     * @enum {string}
     */
    StopKind: 'formal' | 'informal';
    /** StopOut */
    StopOut: {
      /**
       * Id
       * Format: uuid
       */
      id: string;
      /** Kind */
      kind: string;
      /** Location */
      location: number[];
      /** Name */
      name: string;
      /** Slug */
      slug: string;
    };
    /** StopOutput */
    StopOutput: {
      /** Location */
      location: [number, number];
      /** Name */
      name: string;
      /** Slug */
      slug: string;
    };
    /** StopPairOut */
    StopPairOut: {
      from_stop: components['schemas']['StopRef'];
      /** Shared Line Count */
      shared_line_count: number;
      to_stop: components['schemas']['StopRef'];
    };
    /** StopPairsOut */
    StopPairsOut: {
      /**
       * Basis
       * @constant
       */
      basis: 'shared_published_lines';
      /** City */
      city: string;
      /** Pairs */
      pairs: components['schemas']['StopPairOut'][];
    };
    /** StopRef */
    StopRef: {
      /** Name */
      name: string;
      /** Slug */
      slug: string;
    };
    /** TotpCodeIn */
    TotpCodeIn: {
      /** Code */
      code: string;
    };
    /** TotpEnrolOut */
    TotpEnrolOut: {
      /** Otpauth Uri */
      otpauth_uri: string;
      /** Secret */
      secret: string;
    };
    /** TotpStatusOut */
    TotpStatusOut: {
      /** Enabled */
      enabled: boolean;
      /** Enabled At */
      enabled_at: string | null;
      /** Pending */
      pending: boolean;
    };
    /** TraceCreated */
    TraceCreated: {
      /**
       * Delete After
       * Format: date-time
       */
      delete_after: string;
      /**
       * Id
       * Format: uuid
       */
      id: string;
      /** Point Count */
      point_count: number;
    };
    /** TraceInput */
    TraceInput: {
      /** City */
      city: string;
      /**
       * Ended At
       * Format: date-time
       */
      ended_at: string;
      /** Points */
      points: components['schemas']['TracePoint'][];
      /**
       * Started At
       * Format: date-time
       */
      started_at: string;
    };
    TraceNumber: number;
    /** TraceOut */
    TraceOut: {
      /**
       * Delete After
       * Format: date-time
       */
      delete_after: string;
      /**
       * Ended At
       * Format: date-time
       */
      ended_at: string;
      /**
       * Id
       * Format: uuid
       */
      id: string;
      /** Point Count */
      point_count: number;
      /** Points */
      points: unknown[];
      /**
       * Started At
       * Format: date-time
       */
      started_at: string;
    };
    TracePoint:
      | [components['schemas']['TraceNumber'], components['schemas']['TraceNumber']]
      | [
          components['schemas']['TraceNumber'],
          components['schemas']['TraceNumber'],
          components['schemas']['TraceNumber'],
        ];
    /** UpdateLine */
    UpdateLine: {
      /** Base Version No */
      base_version_no: number;
      changes: components['schemas']['LineChanges'];
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      kind: 'update_line';
      /**
       * Line
       * Format: uuid
       */
      line: string;
      /** Photo Id */
      photo_id?: string | null;
    };
    /** UpdateStop */
    UpdateStop: {
      changes: components['schemas']['StopChanges'];
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      kind: 'update_stop';
      /** Photo Id */
      photo_id?: string | null;
      /**
       * Stop
       * Format: uuid
       */
      stop: string;
    };
    /**
     * UserRole
     * @enum {string}
     */
    UserRole: 'user' | 'contributor' | 'moderator' | 'admin';
    /** ValidationError */
    ValidationError: {
      /** Context */
      ctx?: Record<string, never>;
      /** Input */
      input?: unknown;
      /** Location */
      loc: (string | number)[];
      /** Message */
      msg: string;
      /** Error Type */
      type: string;
    };
    /** VerifyIn */
    VerifyIn: {
      /**
       * Mode
       * @enum {string}
       */
      mode: 'cookie' | 'bearer';
      /** Password */
      password?: string | null;
      /** Token */
      token: string;
    };
    /** VersionOut */
    VersionOut: {
      /** Fare Minor */
      fare_minor: number | null;
      /**
       * Published At
       * Format: date-time
       */
      published_at: string;
      /** Stop Count */
      stop_count: number;
      /** Version No */
      version_no: number;
    };
    /** WalkOutput */
    WalkOutput: {
      from_stop: components['schemas']['StopOutput'] | null;
      /**
       * Kind
       * @default walk
       * @constant
       */
      kind: 'walk';
      /** Metres */
      metres: number;
      to_stop: components['schemas']['StopOutput'] | null;
    };
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
  list_audit_logs_v1_admin_audit_logs_get: {
    parameters: {
      query?: {
        action?: string | null;
        actor_id?: string | null;
        limit?: number;
        offset?: number;
        since?: string | null;
        target_id?: string | null;
        target_type?: string | null;
        until?: string | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AuditLogPage'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  create_export_v1_admin_exports__city__post: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        city: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AdminExportOut'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  list_users_v1_admin_users_get: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number;
        role?: components['schemas']['UserRole'] | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AdminUserPage'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  change_role_v1_admin_users__identity__role_patch: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        identity: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['RoleChangeIn'];
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AdminUserOut'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  csrf_v1_auth_csrf_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CsrfOut'];
        };
      };
    };
  };
  login_v1_auth_login_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['LoginIn'];
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json':
            components['schemas']['CookieOut'] | components['schemas']['BearerOut'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  logout_v1_auth_logout_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  logout_all_v1_auth_logout_all_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  magic_link_v1_auth_magic_link_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['MagicLinkIn'];
      };
    };
    responses: {
      /** @description Successful Response */
      202: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['StatusOut'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  magic_link_verify_v1_auth_magic_link_verify_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['VerifyIn'];
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json':
            components['schemas']['CookieOut'] | components['schemas']['BearerOut'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  refresh_v1_auth_refresh_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['RefreshIn'];
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['RefreshOut'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  register_v1_auth_register_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['RegisterIn'];
      };
    };
    responses: {
      /** @description Successful Response */
      202: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['StatusOut'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  step_up_v1_auth_step_up_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['TotpCodeIn'];
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['StepUpOut'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  list_cities_v1_cities_get: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CityOut'][];
        };
      };
    };
  };
  read_city_v1_cities__slug__get: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        slug: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CityDetailOut'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  download_pack_v1_cities__slug__pack_get: {
    parameters: {
      query?: never;
      header: {
        'X-Pack-Request': string;
      };
      path: {
        slug: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  sitemap_v1_cities__slug__sitemap_get: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        slug: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            [key: string]: unknown;
          };
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  stop_pairs_v1_cities__slug__stop_pairs_get: {
    parameters: {
      query?: {
        limit?: number;
      };
      header?: never;
      path: {
        slug: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['StopPairsOut'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  tiles_v1_cities__slug__tiles_pmtiles_get: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        slug: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': unknown;
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  list_edits_v1_edits_get: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['EditOut'][];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  propose_edit_v1_edits_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json':
          | components['schemas']['NewLine']
          | components['schemas']['UpdateLine']
          | components['schemas']['NewStop']
          | components['schemas']['UpdateStop']
          | components['schemas']['FareUpdate']
          | components['schemas']['Retire'];
      };
    };
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['EditOut'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  read_edit_v1_edits__identity__get: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        identity: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['EditOut'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  latest_geojson_v1_export__city__latest_geojson_get: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        city: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': unknown;
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  health_v1_health_get: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HealthStatus'];
        };
      };
    };
  };
  list_lines_v1_lines_get: {
    parameters: {
      query: {
        city: string;
        limit?: number;
        offset?: number;
        q?: string | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['LineListOut'][];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  read_line_v1_lines__slug__get: {
    parameters: {
      query: {
        city: string;
      };
      header?: never;
      path: {
        slug: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['LineOut'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  list_versions_v1_lines__slug__versions_get: {
    parameters: {
      query: {
        city: string;
      };
      header?: never;
      path: {
        slug: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['VersionOut'][];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  me_v1_me_get: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['MeOut'];
        };
      };
    };
  };
  delete_me_v1_me_delete: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['DeleteMeIn'];
      };
    };
    responses: {
      /** @description Successful Response */
      202: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['StatusOut'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  patch_me_v1_me_patch: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['PatchMeIn'];
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['MeOut'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  list_favorites_v1_me_favorites_get: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['FavoriteOut'][];
        };
      };
    };
  };
  read_favorite_v1_me_favorites__line_id__get: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        line_id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['FavoriteOut'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  put_favorite_v1_me_favorites__line_id__put: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        line_id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  delete_favorite_v1_me_favorites__line_id__delete: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        line_id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  licence_accept_v1_me_licence_accept_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['EmptyIn'];
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['MeOut'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  status_v1_me_totp_get: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TotpStatusOut'];
        };
      };
    };
  };
  disable_v1_me_totp_delete: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  confirm_v1_me_totp_confirm_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['TotpCodeIn'];
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TotpStatusOut'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  enrol_v1_me_totp_enrol_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['EmptyIn'];
      };
    };
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TotpEnrolOut'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  presign_photo_v1_media_presign_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['PresignInput'];
      };
    };
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PresignOut'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  queue_v1_moderation_edits_get: {
    parameters: {
      query?: {
        limit?: number;
        offset?: number;
        state?: 'pending' | 'approved' | 'rejected' | 'withdrawn';
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['QueueOut'][];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  approve_edit_v1_moderation_edits__identity__approve_post: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        identity: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['EditOut'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  reject_edit_v1_moderation_edits__identity__reject_post: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        identity: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['RejectInput'];
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['EditOut'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  rollback_line_v1_moderation_lines__identity__rollback_post: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        identity: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['RollbackInput'];
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['VersionOut'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  create_plan_v1_plan_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['PlanInput'];
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PlanOutput'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  sitemap_index_v1_sitemap_get: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SitemapIndexOut'];
        };
      };
    };
  };
  search_stops_v1_stops_get: {
    parameters: {
      query: {
        city: string;
        limit?: number;
        q?: string | null;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['StopOut'][];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  read_stop_v1_stops__slug__get: {
    parameters: {
      query: {
        city: string;
      };
      header?: never;
      path: {
        slug: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['StopDetail'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  near_stops_v1_stops_near_get: {
    parameters: {
      query: {
        lat: number;
        lng: number;
        radius?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['StopOut'][];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  upload_trace_v1_traces_post: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['TraceInput'];
      };
    };
    responses: {
      /** @description Successful Response */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TraceCreated'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  read_trace_v1_traces__identity__get: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        identity: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TraceOut'];
        };
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
  delete_trace_v1_traces__identity__delete: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        identity: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Successful Response */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Validation Error */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HTTPValidationError'];
        };
      };
    };
  };
}
