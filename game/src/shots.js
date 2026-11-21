// Deterministic screenshot scenes, selected with ?shot=<name>.
// Each scene arranges the world through the same public hooks the game
// itself uses (spawning cars, setting wanted heat, opening a briefing), then
// hands main.js a fixed camera. The capture script in tools/ loads each
// scene, waits for window.__solano.ready, and photographs the frame — the
// screenshots in an entry are real renders of the shipped game.

export function applyShot(ctx, name) {
  switch (name) {
    case 'cover': {
      // The hero shot: a Comet GT on the Coral Beach avenue at golden hour,
      // driver standing at the door, ocean behind the palms.
      const car = ctx.spawnCar('comet', 0xd64541, 258, 66, 0.5);
      ctx.placePlayer(254.5, 62.5, 2.2);
      ctx.setCamera({ x: 250.5, y: 1.9, z: 56.5 }, { x: 258.5, y: 1.0, z: 66.5 });
      return car;
    }
    case 'onfoot': {
      // Downtown on foot: towers, traffic, pedestrians, the whole HUD.
      ctx.placePlayer(24, -48, 2.6);
      ctx.spawnCar('merit', 0x3f6fb5, 21, -30, 0).driver = 'parked';
      ctx.setCamera({ x: 30, y: 2.6, z: -58 }, { x: 22, y: 1.4, z: -44 });
      return null;
    }
    case 'chase': {
      // Three stars on the Midtown avenue: the player's Comet at speed with
      // two Interceptors already on its tail.
      const car = ctx.spawnCar('comet', 0x3f6fb5, 100, 6, 0);
      car.speed = 17;
      ctx.enterCar(car);
      ctx.setWanted(320);
      ctx.placeCop(96.5, -9, 0.15);
      ctx.placeCop(104, -7, -0.12);
      ctx.setCamera({ x: 93, y: 4.4, z: -13 }, { x: 101, y: 1.2, z: 10 });
      return car;
    }
    case 'mission': {
      // At Marisol's corner with the first job offered: briefing panel,
      // golden giver beacon and the minimap marker all in frame.
      ctx.placePlayer(248.5, 47.5, -2.2);
      ctx.openBriefing();
      ctx.setCamera({ x: 240, y: 2.4, z: 55 }, { x: 248, y: 1.3, z: 44 });
      return null;
    }
    default:
      return null;
  }
}

export const SHOT_NAMES = ['cover', 'onfoot', 'chase', 'mission'];
