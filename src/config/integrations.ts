// Provider registry for admin-managed third-party API integrations.
// To add a new provider: append an entry below + create a `<testEndpoint>` edge function.

export type IntegrationFieldType = "text" | "password" | "textarea";

export interface IntegrationField {
  key: string;            // stored as integration_credentials.field_key
  label: string;
  type: IntegrationFieldType;
  placeholder: string;
  helpText: string;
  required: boolean;
}

export interface Integration {
  id: string;
  name: string;
  description: string;
  docsUrl: string;
  setupSteps: string[];
  fields: IntegrationField[];
  testEndpoint: string;   // edge function name
}

export const INTEGRATIONS: Integration[] = [
  {
    id: "apple_music",
    name: "Apple Music",
    description: "Search the Apple Music catalog and import tracks for analysis.",
    docsUrl: "https://developer.apple.com/documentation/applemusicapi",
    setupSteps: [
      "Enroll in the Apple Developer Program ($99/yr) at developer.apple.com.",
      "In the dev portal: Certificates, IDs & Profiles → Identifiers → register a new Media ID (e.g. media.com.yourapp).",
      "Go to Keys → create a new key, enable MusicKit, and download the .p8 private key file (only once!).",
      "Note your 10-character Team ID (top-right of the dev portal) and the Key ID (shown when you created the key).",
      "Paste the Team ID, Key ID, and the full contents of the .p8 file below, then click Test Connection.",
    ],
    fields: [
      {
        key: "APPLE_TEAM_ID",
        label: "Team ID",
        type: "text",
        placeholder: "ABCDE12345",
        helpText: "10-character alphanumeric ID, top-right of the Apple Developer portal.",
        required: true,
      },
      {
        key: "APPLE_KEY_ID",
        label: "Key ID",
        type: "text",
        placeholder: "ABCDE12345",
        helpText: "10-character ID shown when you created the MusicKit key.",
        required: true,
      },
      {
        key: "APPLE_PRIVATE_KEY",
        label: ".p8 Private Key",
        type: "textarea",
        placeholder: "-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMG...\n-----END PRIVATE KEY-----",
        helpText: "Paste the full contents of the AuthKey_XXXXX.p8 file, including BEGIN/END lines.",
        required: true,
      },
    ],
    testEndpoint: "apple-music-test",
  },
];
