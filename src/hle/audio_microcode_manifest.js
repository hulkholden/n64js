// Reviewed task-start identities, not SDK versions or HLE dispatch rules.
// Ranges and loading layouts are reviewed in docs/audio-microcode-coverage.md.
// entrySha256 is only a lookup aid; acceptance checks the full code and data.
// Only hashes are stored here. ROM names and structural fingerprints are never
// classifier inputs.

export const audioMicrocodeManifest = {
  "version": 1,
  "scope": "reviewed-task-start",
  "bootstraps": [
    {
      "id": "rspboot-208",
      "bytes": 208,
      "sha256": "589d793eda195c576c9d767e7a5e4b77352826f59669d20bdcc358a8ebc979a3"
    },
    {
      "id": "rspboot-204",
      "bytes": 204,
      "sha256": "1ba0243414cec468a9bd90fc91f5b5efa918208e2cf799ae54fb09673442c001"
    }
  ],
  "programs": [
    {
      "id": "abi1-standard-mixer",
      "family": "ABI1",
      "entrySha256": "25217c5a5472ceaa96928d95051905ca69ffea81f129524518ce14c468530b2c",
      "codeBytes": 3616,
      "codeSha256": "14e3b245e8cd4e0bdf4cbb864af82d1ccba6d3d3ff33f73cb52c5821a76f30fc",
      "dataBytes": 704,
      "dataSha256": "79bb2a3e8555019bc4b229f0c218f1e329ca5711bfa55c7c7f992facf2e12c83"
    },
    {
      "id": "abi1-tetrisphere-us-mixer",
      "family": "ABI1",
      "entrySha256": "25217c5a5472ceaa96928d95051905ca69ffea81f129524518ce14c468530b2c",
      "codeBytes": 3568,
      "codeSha256": "30f68cb1f957fa85c2c19706bb32d59cf3354548a2fbb66ac9acc7a66a639470",
      "dataBytes": 704,
      "dataSha256": "79bb2a3e8555019bc4b229f0c218f1e329ca5711bfa55c7c7f992facf2e12c83"
    },
    {
      "id": "abi1-diddy-blast-mixer",
      "family": "ABI1",
      "entrySha256": "c38ac11909fc9e7554dfd0af0e36bb8193a10ef3859ba744737f9664c0024a80",
      "codeBytes": 3776,
      "codeSha256": "3e7baf98602f869e1f7294f68a474de3f2db13927403180ea39f5324ce3db5cc",
      "dataBytes": 720,
      "dataSha256": "523f39e3bdcb05c64d633ef77e6f5e123fad261cf2ce22e8ede25f21ec172cfa"
    },
    {
      "id": "abi1-goldeneye-mixer",
      "family": "ABI1",
      "entrySha256": "25217c5a5472ceaa96928d95051905ca69ffea81f129524518ce14c468530b2c",
      "codeBytes": 3520,
      "codeSha256": "ae28967ac5ef8a746f761a24897988006ddde24212a333355dfba97d363ba7e0",
      "dataBytes": 704,
      "dataSha256": "e6afb20043c940e2e85a9ecb1fb064b183e9389eb8e3b1b260726d2477b28c7a"
    },
    {
      "id": "naudio-standard",
      "family": "NAUDIO",
      "entrySha256": "92914a059169e3e7d5517b4458e159653685a44bfc5e9ecce3e648b436305fc4",
      "codeBytes": 3168,
      "codeSha256": "7e5932658e7f965a47b9dac8ec05b405e9ac18c26d39daddb852418f66613ba4",
      "dataBytes": 688,
      "dataSha256": "514cfa7012475c8cd8c6acf1a91b8dd85861c517fdf9c7fa90e90cb3b2736f48"
    },
    {
      "id": "naudio-banjo-kazooie",
      "family": "NAUDIO",
      "entrySha256": "c0b750a325be267792f3791e463d55c7d7f9efec1cac1e0561a90b01f9d40191",
      "codeBytes": 3168,
      "codeSha256": "a31055215f1dfd7e071ae9c0cae3bbaa5bf6e4f94dc58eedb3739304218735c7",
      "dataBytes": 688,
      "dataSha256": "2cedcb30f29ab3c12b278a258af10045e37d3ed7c2e20e2ae36db9eabc0f8582"
    },
    {
      "id": "naudio-donkey-kong-64",
      "family": "NAUDIO",
      "entrySha256": "7521f740f4d3ae8bdc0f0e180b32b2f59025f8ddc0f3bd5c2fef6a6a749a0db3",
      "codeBytes": 3120,
      "codeSha256": "1b3b296a1d99bcbee58ac9e46a9fd68eaa2c9a96378d241d3b0fbcfc26a942d3",
      "dataBytes": 688,
      "dataSha256": "a1999f3e421846b2df2d601fcc46903890534283cf815c021d590782c04db5a5"
    },
    {
      "id": "nead-mario-kart",
      "family": "NEAD",
      "entrySha256": "3c4a93378d8ce8f2b79590c8d201625b27e76578f06be7bdd35b331b71d68061",
      "codeBytes": 3184,
      "codeSha256": "4099f5a779b1efee37fddc52fb4625bffe334f4af71cef78bfd2973d1c08259c",
      "dataBytes": 768,
      "dataSha256": "f2d3cb80a427b0cb08ea92b9d3d5b0848c186b1cb60d1a34c1e07db50a0ea3c7"
    },
    {
      "id": "nead-wave-race-shindou",
      "family": "NEAD",
      "entrySha256": "0d863303f1c84bd5f5af612130936238c30989dcb20f4c30ab09e8364e96c020",
      "codeBytes": 3936,
      "codeSha256": "010b926887d0f433711b503748f25029202f7036af00b3b29ca8429ee498267d",
      "dataBytes": 816,
      "dataSha256": "d285d6cf31975929114a1f7917bbb3dfa62d650437d0eff06789be65d0366843"
    },
    {
      "id": "nead-star-fox",
      "family": "NEAD",
      "entrySha256": "0d863303f1c84bd5f5af612130936238c30989dcb20f4c30ab09e8364e96c020",
      "codeBytes": 3840,
      "codeSha256": "53e5cf11023217cab8336d0b12e5a4d5e607c72c1e17a1909b155f96d9b1a690",
      "dataBytes": 816,
      "dataSha256": "41420aa507cbad484435f7c3a4f0ebe05c410d9fc93ef07237a3a23bc7c3689f"
    },
    {
      "id": "nead-star-fox-revision",
      "family": "NEAD",
      "entrySha256": "3111d480f1bbd61a19e0366717c5a040b1574e3a11d43f70e679066f3ed101bc",
      "codeBytes": 3856,
      "codeSha256": "988c4e33c1fd72da457831a30b0b1c6f21c0d36b4f5f95702e293fec7782b4e5",
      "dataBytes": 816,
      "dataSha256": "4eb2919a3a0fb9e1d2c0d27ce3dc44676a7a3630de99e35d3a4b1a8c1f8b32f6"
    },
    {
      "id": "nead-mario-shindou",
      "family": "NEAD",
      "entrySha256": "0d863303f1c84bd5f5af612130936238c30989dcb20f4c30ab09e8364e96c020",
      "codeBytes": 3856,
      "codeSha256": "2913b245354c35108e763b03cef95b6455b56409ceb2be20b0f1b976447d6a8f",
      "dataBytes": 816,
      "dataSha256": "fe71e15e5688314458f3aa760b44f1fffa4b9d0b04f3e1b1514618283c70eeb2"
    },
    {
      "id": "nead-yoshi-story",
      "family": "NEAD",
      "loader": "direct",
      "entrySha256": "d6ce491945b10a3996631b69f422eafa1b612da79876782b3c4611e72d35132f",
      "codeBytes": 3920,
      "codeSha256": "d3f55a65cf5b4e5046e39be1973ace22f9b7bfa5ae39d479288073ad9125fa7e",
      "dataBytes": 736,
      "dataSha256": "36654bb434ef31a88d3bd51de4c4b96bdba584f5f87cacec21a5772d9a09f257"
    },
    {
      "id": "nead-ocarina",
      "family": "NEAD",
      "loader": "direct",
      "entrySha256": "61a0a49245a82b99a372514326a19f6a55151210670a6f03eedc0d14a6052d9e",
      "codeBytes": 4016,
      "codeSha256": "7948514457d822e1cbebfe67513fc8ecf9b2b3b812750093fe082c3145eab191",
      "dataBytes": 736,
      "dataSha256": "7a2773900752702bd70e073813f6e57601a9c1c741b07057799bd882eaa10e27"
    },
    {
      "id": "nead-majora-stadium",
      "family": "NEAD",
      "loader": "direct",
      "entrySha256": "c784b21927a2da431b99ded5d96a4d942589cd4bbc685deee1e1b602fb7747c5",
      "codeBytes": 4096,
      "codeSha256": "b19b603dd2c2c37ac28734648a5acfb39712caa8b154c46336c8ea1e1bc0e8d6",
      "dataBytes": 736,
      "dataSha256": "f81b8169de88a5fdfee93ba9d59cb6885647199cbd5a4c22c98d9fc39a5657a9"
    },
    {
      "id": "nead-1080",
      "family": "NEAD",
      "loader": "direct",
      "entrySha256": "d199aecddfef839e63b61bac7522c0e2ff51206cd674e0a553d47b79c03b0e50",
      "codeBytes": 3968,
      "codeSha256": "2a7f9b924c89434623ffcf0ed96b9400ec425adbdc22dce638c1115fae653837",
      "dataBytes": 736,
      "dataSha256": "97c81caebde9593db430832b46a729cda80ead6965bd4713e66ae86b24680693"
    },
    {
      "id": "nead-f-zero",
      "family": "NEAD",
      "loader": "direct",
      "entrySha256": "587055f243f4eba8eaef3f1e13e02a8d10a0c2dc3fa0b007e70946e3f6618f94",
      "codeBytes": 3392,
      "codeSha256": "a7a87ac589b2046dc3223899ad734584d567c05ddbfa16a937b54acdd5911e95",
      "dataBytes": 736,
      "dataSha256": "b57e74a66204cec3ac2495b1a876e3d277c85b622488eb901eb0a4a9384b743e"
    },
    {
      "id": "nead-animal-forest",
      "family": "NEAD",
      "loader": "direct",
      "entrySha256": "35c5ff1b9ad1807409168f682358157b2b6fa26c7ad1c2b369208183036da7ac",
      "codeBytes": 3920,
      "codeSha256": "8afa4c9e05184e509d53718d6a26dc9d0e803eac11fcd7b5389fec205b4a5c6d",
      "dataBytes": 736,
      "dataSha256": "d17f010cd99dd3f45c4e3e581154db05731a17804209b96899e181f5ea1ace64"
    },
    {
      "id": "descriptor-synth-twine",
      "family": "Unknown",
      "entrySha256": "d5af6299829789b4c58404f4245eb7a6e9e52f9b9cd5826c6a2a0e87764e1875",
      "codeBytes": 3904,
      "codeSha256": "afc63003d7e820718ef4ec6e11a84c2eda95a04d154c2df031d5260d65a36b94",
      "dataBytes": 560,
      "dataSha256": "8567eb365b231fef6a2cd4311a1e16be640b78cfb211a8d68aced477aeb2406b"
    },
    {
      "id": "descriptor-synth-re2",
      "family": "Unknown",
      "entrySha256": "5b2bb75c3c7b75c6eca050434b3493f9fccb6b3f444299459dfff481c4129bbe",
      "codeBytes": 3904,
      "codeSha256": "61db91a646bef2d59a80955ffeaf1895928a90ee1355e26dc8d63a7f942a539b",
      "dataBytes": 560,
      "dataSha256": "8567eb365b231fef6a2cd4311a1e16be640b78cfb211a8d68aced477aeb2406b"
    }
  ]
};
