const WORD_PAIRS = [
  ["gray", "shark"], ["blue", "whale"], ["red", "tiger"], ["gold", "eagle"],
  ["dark", "raven"], ["iron", "wolf"], ["silver", "fox"], ["jade", "cobra"],
  ["steel", "hawk"], ["bronze", "bear"], ["black", "panther"], ["white", "falcon"],
  ["green", "viper"], ["amber", "lion"], ["crimson", "dragon"], ["pearl", "dove"],
  ["copper", "otter"], ["onyx", "lynx"], ["coral", "crane"], ["slate", "badger"],
  ["azure", "heron"], ["ivory", "stag"], ["ebony", "swan"], ["ruby", "finch"],
  ["opal", "robin"], ["topaz", "wren"], ["sapphire", "jay"], ["emerald", "owl"],
  ["garnet", "lark"], ["zircon", "kite"], ["jasper", "dove"], ["quartz", "crow"],
  ["flint", "sparrow"], ["cobalt", "magpie"], ["nickel", "swallow"], ["chrome", "starling"],
  ["titanium", "oriole"], ["platinum", "cardinal"], ["zinc", "pigeon"], ["lead", "vulture"],
  ["mercury", "pelican"], ["carbon", "ibis"], ["silicon", "condor"], ["neon", "toucan"],
  ["argon", "parrot"], ["xenon", "macaw"], ["radon", "cuckoo"], ["krypton", "canary"],
  ["helium", "budgie"], ["lithium", "cockatiel"], ["boron", "lovebird"], ["sodium", "finch"],
  ["magnesium", "weaver"], ["aluminum", "bunting"], ["phosphorus", "grosbeak"], ["sulfur", "tanager"],
  ["chlorine", "warbler"], ["potassium", "thrush"], ["calcium", "robin"], ["scandium", "wagtail"],
  ["vanadium", "pipit"], ["chromium", "lark"], ["manganese", "dunnock"], ["cobalt", "chat"],
  ["copper", "wheatear"], ["gallium", "stonechat"], ["germanium", "whinchat"], ["arsenic", "redstart"],
  ["selenium", "flycatcher"], ["bromine", "nightingale"], ["rubidium", "robin"], ["strontium", "wren"],
  ["yttrium", "warbler"], ["zirconium", "babbler"], ["niobium", "cisticola"], ["molybdenum", "prinia"],
  ["technetium", "apalis"], ["ruthenium", "sunbird"], ["rhodium", "spiderhunter"], ["palladium", "white-eye"],
  ["silver", "yuhina"], ["cadmium", "fulvetta"], ["indium", "laughingthrush"], ["tin", "minivet"],
  ["antimony", "drongo"], ["tellurium", "shrike"], ["iodine", "cuckooshrike"], ["cesium", "triller"],
  ["barium", "woodswallow"], ["lanthanum", "artamus"], ["cerium", "butcherbird"], ["praseodymium", "currawong"]
];

export const LTE_PASSWORDS = {};
export const PASSWORD_TO_SLOT = {};

WORD_PAIRS.forEach((pair, index) => {
  const slot = index + 1;
  const password = `${pair[0]}-${pair[1]}`;
  LTE_PASSWORDS[slot] = password;
  PASSWORD_TO_SLOT[password] = slot;
});

export function resolveLtePassword(input) {
  const normalized = input.toLowerCase().trim();
  return PASSWORD_TO_SLOT[normalized] || null;
}

export function getAllPasswords() {
  return Object.entries(LTE_PASSWORDS).map(([slot, password]) => ({
    slot: Number(slot),
    password
  }));
}
