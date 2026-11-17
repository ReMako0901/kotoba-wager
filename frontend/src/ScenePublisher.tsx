import { useLayoutEffect, useState } from 'react';
import { StagePublisher } from './Anoma';
import { chooseScene, type SceneKey } from './sceneDialogue';

// Select only on entry to a scene, never on unrelated renders (including polling).
export function ScenePublisher({ scene }: { scene: SceneKey }) {
  const [content, setContent] = useState<ReturnType<typeof chooseScene>>();
  useLayoutEffect(() => { setContent(chooseScene(scene)); }, [scene]);
  return content ? <StagePublisher {...content} /> : null;
}
