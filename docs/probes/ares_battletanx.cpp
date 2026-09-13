// Headless timing comparison for n64js #103. Build with build_ares_probe.py.
// Requires the pinned ares checkout and the user's own big-endian ROM.
#include <n64/n64.hpp>
#include <chrono>
#include <cstdio>
#include <set>

using namespace ares;
namespace N = ares::Nintendo64;

struct Host : ares::Platform {
  VFS::Pak system = std::make_shared<vfs::directory>();
  VFS::Pak cartridge = std::make_shared<vfs::directory>();
  VFS::Pak controller = std::make_shared<vfs::directory>();

  auto pak(Node::Object node) -> VFS::Pak override {
    if(node->name() == "Nintendo 64") return system;
    if(node->name() == "Nintendo 64 Cartridge") return cartridge;
    return controller;
  }

  auto audio(Node::Audio::Stream stream) -> void override {
    double samples[8];
    while(stream->pending()) stream->read(samples);
  }
};

struct RdramState {
  N::RDRAM::Chip chips[4];
  decltype(N::ri.io) ri;
  bool captured = false;
};

static auto point(const char* mode, const char* name, uint64_t elapsed,
                  uint64_t instructions) -> void {
  const auto& profile = N::cpu.profile;
  printf("{\"mode\":\"%s\",\"name\":\"%s\",\"pc\":\"0x%08x\","
         "\"halfCycles\":%llu,\"count\":%llu,\"instructions\":%llu,"
         "\"v0\":%u,\"v1\":%u,\"icacheMisses\":%lld,"
         "\"dcacheMisses\":%lld,\"dcacheWritebacks\":%lld}\n",
         mode, name, (uint32_t)N::cpu.ipu.pc,
         (unsigned long long)elapsed,
         (unsigned long long)(N::cpu.effectiveCount() >> 1),
         (unsigned long long)instructions,
         (uint32_t)N::cpu.ipu.r[2].u64, (uint32_t)N::cpu.ipu.r[3].u64,
         (long long)profile.icacheMisses, (long long)profile.dcacheMisses,
         (long long)profile.dcacheWritebacks);
  fflush(stdout);
}

static auto run(uint32_t contInit, bool skipInit, RdramState& state) -> bool {
  N::system.power(false);
  N::cpu.profile = {};
  // The normal frontend obtains hidden RDRAM from Vulkan. Supply storage only;
  // CPU, RDRAM, RI, PI, PIF, cache and event timing remain the reference code's.
  std::vector<uint8_t> hidden(4 * 1024 * 1024);
  N::rdram.hidden.data = hidden.data();
  std::set<uint32_t> seen;
  uint64_t elapsed = 0, instructions = 0;
  const char* mode = skipInit ? "skip-rdram-init" : "full";
  const auto wallDeadline = std::chrono::steady_clock::now() + std::chrono::seconds(120);

  while(elapsed < 187500000ull * 3) {
    uint32_t pc = N::cpu.ipu.pc;
    if(pc == 0xa4000040 && skipInit && !seen.count(pc)) {
      if(!state.captured) return false;
      // Reuse this same image's successfully initialized chip/RI state, with
      // memory size supplied as n64js does. IPL3 then takes its existing skip
      // branch. Do not change CPU COUNT, PC, instructions or event deadlines.
      std::copy(std::begin(state.chips), std::end(state.chips), N::rdram.chips);
      N::ri.io = state.ri;
      N::rdram.updateMapping();
      N::rdram.ram.write<4>(0x318, 0x800000, N::RBusDevice::ARES_DEBUGGER);
    }
    if(pc == 0xa4000458 && !skipInit && !seen.count(pc)) {
      if(!N::rdram.mapIdentity ||
         N::rdram.ram.read<4>(0x318, N::RBusDevice::ARES_DEBUGGER) != 0x800000) return false;
      std::copy(std::begin(N::rdram.chips), std::end(N::rdram.chips), state.chips);
      state.ri = N::ri.io;
      state.captured = true;
    }

    const char* name = nullptr;
    switch(pc) {
    case 0xa4000040: name = "ipl3Entry"; break;
    case 0xa4000060: name = "rdramInit"; break;
    case 0xa4000410: name = "rdramInitSkipped"; break;
    case 0xa4000458: name = "afterRdramInit"; break;
    case 0x80000000: name = "relocatedIpl3"; break;
    case 0x80000050: name = "bootDmaStart"; break;
    case 0x800000d8: name = "bootDmaComplete"; break;
    case 0x80071000: name = "gameEntry"; break;
    case 0x80071030: name = "bssCleared"; break;
    }
    if(pc == contInit) name = "osContInit";
    if(pc == contInit + 0x3c) name = "controllerTime";
    if(name && seen.insert(pc).second) {
      point(mode, name, elapsed + N::cpu.clock, instructions);
      if(pc == contInit + 0x3c) {
        N::rdram.hidden.data = nullptr;
        return true;
      }
    }

    if(N::cpu.instruction()) {
      elapsed += N::cpu.clock;
      N::cpu.synchronize();
    }
    ++instructions;
    if(instructions % 1000000 == 0 && std::chrono::steady_clock::now() > wallDeadline) break;
  }
  N::rdram.hidden.data = nullptr;
  fprintf(stderr, "Did not reach controller time in %s run\n", mode);
  return false;
}

int main(int argc, char** argv) {
  if(argc != 3) {
    fprintf(stderr, "Usage: ares-battletanx <ares checkout> <big-endian ROM>\n");
    return 2;
  }
  auto rom = file::read(argv[2]);
  const string hash = Hash::SHA256(rom).digest();
  uint32_t contInit = 0;
  bool pal = false;
  if(hash == "c5b7cf3523de025e3f18e2c8df2deb0eced5613e7c46cb8c6c5a4f22644ead3f") contInit = 0x80110fe0;
  if(hash == "88268ce770ff39f2ca839848b842c87866df6c5ddaf775f180b2522c18ff6221") contInit = 0x801033f0;
  if(hash == "8c0f538d32243d7d230ff28432326fbb17ea59bec2e2d9815dc04317dbe70db0") {
    contInit = 0x801003c0;
    pal = true;
  }
  if(!contInit) {
    fprintf(stderr, "Unknown big-endian ROM SHA-256: %s\n", hash.data());
    return 2;
  }
  Host host;
  ares::platform = &host;
  auto ntsc = file::read(string{argv[1], "/mia/Firmware/Nintendo 64/pif.ntsc.rom"});
  auto palPif = file::read(string{argv[1], "/mia/Firmware/Nintendo 64/pif.pal.rom"});
  if(ntsc.size() != 0x7c0 || palPif.size() != 0x7c0) {
    fprintf(stderr, "Missing PIF firmware in reference checkout\n");
    return 2;
  }
  host.system->append("pif.ntsc.rom", ntsc);
  host.system->append("pif.pal.rom", palPif);
  host.cartridge->append("program.rom", rom);
  host.cartridge->setAttribute("title", "BattleTanx timing probe");
  host.cartridge->setAttribute("region", pal ? "PAL" : "NTSC");
  host.cartridge->setAttribute("cic", pal ? "CIC-NUS-7101" : "CIC-NUS-6102");
  N::option("Deterministic Entropy", "true");
  N::option("Recompiler", "false");
  N::option("Expansion Pak", "true");
  Node::System root;
  if(!N::load(root, pal ? "[Nintendo] Nintendo 64 (PAL)" : "[Nintendo] Nintendo 64 (NTSC)")) return 2;
  auto slot = root->find<Node::Port>("Cartridge Slot");
  slot->allocate();
  slot->connect();
  auto pad = root->find<Node::Port>("Controller Port 1");
  pad->allocate("Gamepad");
  pad->connect();
  printf("{\"sha256\":\"%s\",\"reference\":\"b15d4d378c0ae59628d914efba1dfac81b07f88f\",\"clockHz\":187500000}\n", hash.data());
  RdramState state{};
  bool success = run(contInit, false, state) && run(contInit, true, state);
  N::system.unload();
  return success ? 0 : 1;
}
