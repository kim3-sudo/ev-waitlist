import { randomInt } from 'node:crypto';

// Short, common, easy-to-type words. Six picks from 256 gives 48 bits of
// entropy -- plenty for a one-time password the admin must change on first login.
const WORDS = [
  'able','acorn','aged','agile','airy','alder','amber','anvil','apex','apple',
  'apron','arch','arena','arrow','ashen','aspen','atlas','attic','aunt','avid',
  'awake','axle','azure','badge','bagel','baker','balmy','banjo','barn','basil',
  'beach','beam','bean','bear','bell','belt','bench','berry','birch','bison',
  'bistro','blaze','bliss','bloom','bluff','boat','bolt','bonus','booth','brave',
  'bread','brick','brine','brook','broom','brush','bubble','buggy','bunny','butter',
  'cabin','cable','cactus','cairn','camel','canal','candy','canoe','cape','caramel',
  'cargo','cedar','chalk','charm','cherry','chess','chime','cider','cinder','civic',
  'clam','clay','cliff','clover','cobalt','cocoa','comet','coral','cosmos','cotton',
  'cougar','cove','crane','crater','cream','crisp','crow','crumb','cubic','cumin',
  'daisy','dance','dawn','decoy','delta','denim','desk','dingo','dinner','disco',
  'dolphin','donut','dove','drift','drum','dune','dusk','eager','eagle','earth',
  'easel','ebony','echo','eel','elbow','elder','ember','emerald','engine','envoy',
  'epoch','equal','fable','falcon','fancy','feather','fern','ferry','fiddle','fig',
  'finch','fjord','flame','flask','fleet','flint','flute','focus','forest','fox',
  'frost','fudge','gable','galaxy','garden','garlic','gecko','geyser','ginger','glacier',
  'glade','glider','globe','goose','gravel','grape','gravy','grove','guitar','gull',
  'habit','hammock','harbor','hazel','heron','hickory','hinge','honey','hornet','hover',
  'humble','icicle','igloo','indigo','iris','ivory','jacket','jaguar','jasmine','jelly',
  'jester','jewel','jolly','journal','jungle','kayak','kelp','kettle','kite','koala',
  'lagoon','lantern','lapis','lattice','lemon','lilac','linen','lizard','lobster','locket',
  'lotus','lumen','lunar','magnet','mango','maple','marble','meadow','melon','meteor',
  'mint','mocha','mosaic','muffin','mural','nectar','nickel','nimbus','noble','nutmeg',
  'oasis','ocean','olive','onyx','opal','orbit','orchid','otter','oyster','paddle',
  'panda','parrot','pebble','pecan','pepper','pickle','pilot','pine','pixel','planet',
  'plum','pocket','polar','pond','poppy','prism','pulse','puzzle','quartz','quilt',
  'rabbit','radish','raven','reef','ribbon','river','robin','rocket','saddle','sailor',
  'salmon','sapphire','scarf','sierra','silver','sketch','solar','sonnet','sparrow','spruce',
  'squid','stable','starling','sunset','swift','tango','tender','thistle','thunder','tiger',
  'timber','tulip','tundra','turtle','velvet','violin','walnut','willow','winter','yacht',
  'yonder','zephyr','zinc','zebra','zesty','zone',
];

const USERNAME_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const DOMAIN = 'ev-waitlist.local';

function randomFrom(list) {
  return list[randomInt(list.length)];
}

// Random login email: "admin-" plus 8 random characters.
export function generateEmail() {
  let username = '';
  for (let i = 0; i < 8; i += 1) username += randomFrom(USERNAME_CHARS);
  return `admin-${username}@${DOMAIN}`;
}

// Random passphrase: six dash-separated words.
export function generatePassphrase(wordCount = 6) {
  const words = [];
  for (let i = 0; i < wordCount; i += 1) words.push(randomFrom(WORDS));
  return words.join('-');
}

export const PASSPHRASE_WORD_POOL_SIZE = WORDS.length;
