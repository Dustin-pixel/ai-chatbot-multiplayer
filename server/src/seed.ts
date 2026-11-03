import { addFact, countLocations, insertLocation, insertNpc } from './db.ts';

/** Seeds "The Lantern Coast" the first time the server starts. Edit freely. */
export function seedWorld(): void {
  if (countLocations() > 0) return;

  insertLocation({
    id: 'gilded_eel',
    name: 'The Gilded Eel',
    description:
      'A low, smoky tavern hunched against the harbour wall. Salt-stained rafters sag under strings of dried fish and tin lanterns, and the hearth roars against the sea damp. Sailors, smugglers and Tidewarden clerks keep to their own corners.',
    exits: ['saltmarket', 'old_road'],
  });
  insertLocation({
    id: 'saltmarket',
    name: 'Saltmarket Docks',
    description:
      'Crowded stalls and creaking piers under a bruise-coloured sky. Gulls scream over the fish carts, and down the quay the harbourmaster\'s office is lit well into the night. Out past the breakwater, the great lighthouse stands dark.',
    exits: ['gilded_eel', 'lighthouse'],
  });
  insertLocation({
    id: 'lighthouse',
    name: 'The Dark Lighthouse',
    description:
      'A tall white tower on a wave-lashed rock, reached by a slick causeway that floods at high tide. The great lamp that guided ships for two hundred years has gone out. The door hangs open.',
    exits: ['saltmarket'],
  });
  insertLocation({
    id: 'old_road',
    name: 'The Old Salt Road',
    description:
      'A rutted cart track winding inland along the cliffs, edged with wind-bent hawthorn. Milestones carved with faded sea-sigils mark the way. Fog rolls in thick off the water by evening.',
    exits: ['gilded_eel', 'mistwood', 'abbey'],
  });
  insertLocation({
    id: 'mistwood',
    name: 'Mistwood Edge',
    description:
      'Ancient oaks crowd the road, their branches hung with pale lichen. Birdsong stops a few steps in. Faint lantern-lights drift between the trunks where no one is carrying them.',
    exits: ['old_road'],
  });
  insertLocation({
    id: 'abbey',
    name: 'The Drowned Abbey',
    description:
      'A ruined abbey half sunk in a tidal marsh, its cloister walkways ankle-deep in black water. A bell still tolls from somewhere beneath the flooded nave, though no rope hangs in the tower.',
    exits: ['old_road'],
  });

  insertNpc({
    id: 'marta_voss',
    name: 'Marta Voss',
    description: 'Broad-shouldered innkeeper of the Gilded Eel, with a ledger-keeper\'s eyes and a laugh like a slammed door.',
    location_id: 'gilded_eel',
    disposition: 'friendly',
    notes: 'Trades rumours for gossip or a fair drink order. Knows the lamplighter vanished the night the light failed.',
  });
  insertNpc({
    id: 'the_courier',
    name: 'The Courier',
    description: 'A rain-slick hooded figure nursing one cup of ale in the darkest corner, a sealed tube strapped to their back.',
    location_id: 'gilded_eel',
    disposition: 'wary',
    notes: 'Carries a message for someone brave and discreet. Will not hand it to anyone who hasn\'t earned some trust.',
  });
  insertNpc({
    id: 'dren_halloway',
    name: 'Captain Dren Halloway',
    description: 'The Tidewarden harbourmaster, silver-bearded and sleepless, forever tapping a brass spyglass against his palm.',
    location_id: 'saltmarket',
    disposition: 'neutral',
    notes: 'Three ships have wrecked since the beacon died. He suspects sabotage but cannot leave his post.',
  });
  insertNpc({
    id: 'old_pell',
    name: 'Old Pell',
    description: 'The lighthouse lamplighter, a gaunt man with soot-black fingers and eyes fixed on something far away.',
    location_id: 'lighthouse',
    disposition: 'afraid',
    notes: 'Hiding in the lamp room. Saw something rise from the water on the night the light died.',
  });
  insertNpc({
    id: 'sister_ilse',
    name: 'Sister Ilse',
    description: 'A soft-spoken nun in a mud-hemmed habit who tends a single candle in the abbey\'s dry corner.',
    location_id: 'abbey',
    disposition: 'secretive',
    notes: 'Knows what the drowned bell is calling. Speaks in careful half-truths.',
  });

  addFact(null, 'Three nights ago every beacon along the Lantern Coast went dark at once, and ships have been wrecking on the rocks since.');
  addFact(null, 'The Tidewardens, a harbour guild, collect tolls and keep order in port towns. They are overstretched and mistrusted.');
  addFact(null, 'The old sea-sigils on milestones and doorposts are said to ward against things that rise from the deep.');
  addFact('abbey', 'The abbey bell tolls at low tide, though its rope rotted away long ago.');
}

export const STARTER_ITEMS = ['traveller\'s cloak', 'belt knife', 'waterskin', '5 silver pennies'];
