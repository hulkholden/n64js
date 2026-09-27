// Reviewed examples for the offline audit, never classifier inputs.
// See docs/audio-microcode-reference.md and docs/audio-microcode-coverage.md.
// null means deliberately unreviewed, not a claim that the ROM has no audio.
export const audioReferenceExamples = [
  {
    "description": "Mario USA",
    "romSha256": "17ce077343c6133f8c9f2d6d6d9a4ab62c8cd2aa57c40aea1f490b4c8bb21d91",
    "imageId": "f9e5d2cc4c2284f7b5ec4948028d2d8aa9f89ab46bb76e583b6164a2a4c5fc44",
    "identity": "abi1-standard-mixer"
  },
  {
    "description": "Tetrisphere Europe",
    "romSha256": "1bb4ed1ef078560e283a4fe942972fb0297bd33d7f9e36cb673358c394176dd1",
    "imageId": "2126e8d8ca94609bf2b77becc950b8e72f9b0bbefb58342e9caafce391d73622",
    "identity": "abi1-standard-mixer"
  },
  {
    "description": "Tetrisphere USA",
    "romSha256": "f7cbc93ac273488bfb89955ab6ae9b60c730907872107a67a56b945e8579ef87",
    "imageId": "2beab41ea522b21f950e6f6e4c877cd774b3ec91f15d9963700633af841c7577",
    "identity": "abi1-tetrisphere-us-mixer"
  },
  {
    "description": "Bootstrap 204 padded to 208",
    "romSha256": "f6a18d9691aecf0e3491b8dfa67cd83d23464d026d9cb03809ab0b980f21f54f",
    "imageId": "923818fdf524b3f74f404d54be71c58ad0cf174d5ac1528b3b4d9243086f65c9",
    "identity": "abi1-standard-mixer"
  },
  {
    "description": "Bootstrap 208",
    "romSha256": "230372b76ca9dd240357cb2760060731e65c54c47c6d6d1535513030aadd64ce",
    "imageId": "d7dacafeddf4b75bdef53b7730de103d2d96d3a4d20260ebe0a3d047486edb8b",
    "identity": "abi1-standard-mixer"
  },
  {
    "description": "Bootstrap 204 copied with adjacent data to 256",
    "romSha256": "95bea63075551b8fa171b104f5d4d51fa405bb38d61bd57f6a31c038b6213ca0",
    "imageId": "ae877913f6a507d0835d25d948349509b95a822da26e504db49acb9371bc0b08",
    "identity": "abi1-standard-mixer"
  },
  {
    "description": "Diddy Kong Racing (v1.1)",
    "romSha256": "7de1a8fb2a9558cfc3d9ad4497df698c1e89cf7095ac1531557df2af40ba8bcf",
    "imageId": "abd474ed3866b5a969c1aefcc93f74ad0ab277b5a02d741fd60bf4988a6b691a",
    "identity": "abi1-diddy-blast-mixer"
  },
  {
    "description": "GoldenEye 007",
    "romSha256": "ec77080ba674068299afea2baf0530165c2a76192025a09c7abbb0b9614cd7ec",
    "imageId": "9beb5582222589812bad19150ef1d73c238bdb5e7a3f12185b882aa9af60d61b",
    "identity": "abi1-goldeneye-mixer"
  },
  {
    "description": "Jet Force Gemini",
    "romSha256": "0e8dce17d1df452787341e6f137d987048b6ba94459dfdfc1da815e332542d71",
    "imageId": "93f0bc24b70f8fe240a4f5e1cdaded5b8e2b2243b0150374ef50253580e46fa5",
    "identity": null
  },
  {
    "description": "Indiana Jones and the Infernal Machine",
    "romSha256": "6e127e592f098a28c92d2032d71c56af1412e5dd189fe792d9238b12a0928c59",
    "imageId": "453f5cb74e03e63fb331c228dbb7cbe6d6ef602056c44b47b0ee8045a7bbb81b",
    "identity": null
  },
  {
    "description": "Perfect Dark",
    "romSha256": "8e432b1a5f4ca512e2c22a1c3a5bb878ff6e92de2ddfebb1ba98e8d00e0394ff",
    "imageId": "77e9e91bc6de9e60effcea3251702b57195fbe8a517f44bd42fc190325fb82b1",
    "identity": null
  },
  {
    "description": "Banjo-Tooie",
    "romSha256": "9ec37fba6890362eba86fb855697a9cff1519275531b172083a1a6a045483583",
    "imageId": "a455b110edc7af4b92c1b3810cf072ed491570a668fd3194dca77f59d19dc1da",
    "identity": null
  },
  {
    "description": "naudio-standard",
    "romSha256": "5b9a8acbee9f677e134232c3b2270848922771072e35a1a2c067bc8e3378758b",
    "imageId": "eb4dc7ccaa5886ce8fa1e29a1fb7b82fa2c56d80c6a387d3b98697acd86ac6fc",
    "identity": "naudio-standard"
  },
  {
    "description": "naudio-banjo-kazooie",
    "romSha256": "d4e7534d8bcdc329386bf28dcb86e35136e793622f3e6913342500d17e89a931",
    "imageId": "2bdc515cc104be0668fb5b17a1174ac13076cedf868bbba3b832fa3d4c3899fe",
    "identity": "naudio-banjo-kazooie"
  },
  {
    "description": "naudio-donkey-kong-64",
    "romSha256": "b6347d9f1f75d38a88d829b4f80b1acf0d93344170a5fbe9546c484dae416ce3",
    "imageId": "66d49008543013c412fa863d7f107f0c7c027ed06e3153806a8b096a54ffad04",
    "identity": "naudio-donkey-kong-64"
  },
  {
    "description": "nead-mario-kart",
    "romSha256": "d6b8538dd63f0132ecb2856e7d32816ed3c30e3e479aecd23cf83fb6ba17a5da",
    "imageId": "3e1f00c87ea54fd0427aa1b8f171e0ee5f5607413c29dfb46ddd5751a1126345",
    "identity": "nead-mario-kart"
  },
  {
    "description": "nead-wave-race-shindou",
    "romSha256": "c53b79a5e6014b5e03b016fadbd5c493270162c17c9624530fc726ea5e3f7b81",
    "imageId": "31a328c7dd7eaf87afb4a752af63e51e12ca986a6a0e0ebb0c07af3e20e80db3",
    "identity": "nead-wave-race-shindou"
  },
  {
    "description": "nead-star-fox",
    "romSha256": "6604c219c2835446522d03a7a3f3634fb00a27703fd6b7f318d98f003806e3a4",
    "imageId": "f05ed8f372d2826914cb59bf05a24c6b049614d28ad29d1e78afc01546e246c0",
    "identity": "nead-star-fox"
  },
  {
    "description": "nead-star-fox-revision",
    "romSha256": "438d5a25aafe7d0b2e490b9a87183ca3f00d2d7ddce6b3a5784c7bdc0cffc7bd",
    "imageId": "473acdb20a500aac101b3df7b20fb5b6feb14004c5a70cff7d27afcd64aa8321",
    "identity": "nead-star-fox-revision"
  },
  {
    "description": "nead-mario-shindou",
    "romSha256": "f8807b5e28f1b1a31c5d3675d23ece73f949ccb553dcbb07972666a1e76adfa2",
    "imageId": "f112d3248718b4b2c37454aaaef103e1f1df14e704ffeaf64aecc9b7c9380361",
    "identity": "nead-mario-shindou"
  },
  {
    "description": "nead-yoshi-story",
    "romSha256": "e8a63388c38f8f0bea37e9b13a97f0898ac5496e08ca2028afb8db9a866e0ce9",
    "imageId": "c3be0f6e59833e54001b384fa10de296dcaa2a92221b18941599227bcaf848ce",
    "identity": "nead-yoshi-story"
  },
  {
    "description": "nead-ocarina",
    "romSha256": "c916ab315fbe82a22169bff13d6b866e9fddc907461eb6b0a227b82acdf5b506",
    "imageId": "16614751437a3ff02a47d8e5b9cbbbcc527ea8d296b08d2ae9bccf0c25234003",
    "identity": "nead-ocarina"
  },
  {
    "description": "nead-majora-stadium",
    "romSha256": "f13571ff5dff3abe42ef1d3c7d2350301ea54dd71ab3c4ff5bf761b0194d6bff",
    "imageId": "febf821b91f06d60d7b941c15e3ef1a86e37293643ddd3e037eacb202189e872",
    "identity": "nead-majora-stadium"
  },
  {
    "description": "nead-1080",
    "romSha256": "5e9d7168e5786ba1bd4b643431ba7100ff3d7a09e558acae15438d426c0f34df",
    "imageId": "3cb8eb5de070a04bfc6d60ecae57b73d7d232b5878284f0b3a3f4879f362c871",
    "identity": "nead-1080"
  },
  {
    "description": "nead-f-zero",
    "romSha256": "2be0f861c30752bbdfa727753a454108bc973c27ad814744f191b1278c1f482d",
    "imageId": "59f789d20be069ebc55a7bd3167b9ebb258870e7b2ebb32ff4013aa817efe39c",
    "identity": "nead-f-zero"
  },
  {
    "description": "nead-animal-forest",
    "romSha256": "d9417be056534fcc0bdff2e6cd5f1135511be7c0a4dace04a96a2649596ce908",
    "imageId": "d2dc593f43fa57e336d4e9872aec722fb64c773c91e8bceda10c9f3eabd309ef",
    "identity": "nead-animal-forest"
  },
  {
    "description": "descriptor-synth-twine",
    "romSha256": "72e3e7b4ff1615bc17336d3d10e18aa9342898db063ace68922a47f5e46c48b1",
    "imageId": "ee33819e7623549ab907bd302c9cc6d1b6d59a9c1a7df3b91c864bdc19e13de3",
    "identity": "descriptor-synth-twine"
  },
  {
    "description": "descriptor-synth-re2",
    "romSha256": "6b960629bab4e865090109fa6e9fefdd42c0194c2f3f4d295bd75c1bc18b233a",
    "imageId": "145b7f079325b7a9961e60b4cafef5004d56be45bb93669923ae4a6342c85033",
    "identity": "descriptor-synth-re2"
  },
  {
    "description": "Conker overlay remains unreviewed",
    "romSha256": "8717054d8edcf1bb9fb4607c7ac8fe4d6fb855fe6506f7e5dcba62e414558178",
    "imageId": "06c450fabaab4083bd295dd8a997c1beddcfcc81f2d2397792ed93e912017cb9",
    "identity": null
  }
];
