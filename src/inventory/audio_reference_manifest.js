// Reviewed task-start identities, not SDK version names or HLE dispatch rules.
// Only hashes are stored here; the derivation and capture references are in
// docs/audio-microcode-reference.md. Do not generate these ranges from variance
// masks or from the structural detector's fingerprints.
export const audioReferenceManifest = {
  version: 1,
  scope: 'reviewed-abi1-task-start',
  bootstraps: [
    { id: 'rspboot-208', bytes: 0xd0, sha256: '589d793eda195c576c9d767e7a5e4b77352826f59669d20bdcc358a8ebc979a3' },
    { id: 'rspboot-204', bytes: 0xcc, sha256: '1ba0243414cec468a9bd90fc91f5b5efa918208e2cf799ae54fb09673442c001' },
  ],
  programs: [
    {
      id: 'abi1-standard-mixer', family: 'ABI1',
      codeBytes: 0xe20, codeSha256: '14e3b245e8cd4e0bdf4cbb864af82d1ccba6d3d3ff33f73cb52c5821a76f30fc',
      dataBytes: 0x2c0, dataSha256: '79bb2a3e8555019bc4b229f0c218f1e329ca5711bfa55c7c7f992facf2e12c83',
    },
    {
      id: 'abi1-tetrisphere-us-mixer', family: 'ABI1',
      codeBytes: 0xdf0, codeSha256: '30f68cb1f957fa85c2c19706bb32d59cf3354548a2fbb66ac9acc7a66a639470',
      dataBytes: 0x2c0, dataSha256: '79bb2a3e8555019bc4b229f0c218f1e329ca5711bfa55c7c7f992facf2e12c83',
    },
  ],
};
