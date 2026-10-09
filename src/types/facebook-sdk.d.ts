export {};

declare global {
  type FacebookEmbeddedSignupExtras =
    | { setup: Record<string, unknown> }
    | {
        setup: Record<string, unknown>;
        featureType: "whatsapp_business_app_onboarding";
        sessionInfoVersion: "3";
      };

  interface Window {
    FB?: {
      init(options: {
        appId: string;
        cookie: boolean;
        xfbml: boolean;
        version: string;
      }): void;
      login(
        callback: (response: FacebookLoginResponse) => void,
        options: {
          config_id: string;
          response_type: "code";
          override_default_response_type: true;
          extras: FacebookEmbeddedSignupExtras;
        },
      ): void;
    };
  }

  interface FacebookLoginResponse {
    status?: "connected" | "not_authorized" | "unknown";
    authResponse?: { code?: string };
  }
}
