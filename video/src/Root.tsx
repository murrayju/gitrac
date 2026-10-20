import { Composition, Folder } from 'remotion';
import { Promo } from './Promo';
import { AgentScene } from './scenes/AgentScene';
import { AuthorScene } from './scenes/AuthorScene';
import { CommitScene } from './scenes/CommitScene';
import { FilesScene } from './scenes/FilesScene';
import { Intro } from './scenes/Intro';
import { Outro } from './scenes/Outro';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Promo"
      component={Promo}
      durationInFrames={1943}
      fps={30}
      width={1920}
      height={1080}
    />
    <Folder name="Scenes">
      <Composition
        id="Intro"
        component={Intro}
        durationInFrames={105}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="Author"
        component={AuthorScene}
        durationInFrames={550}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="Files"
        component={FilesScene}
        durationInFrames={285}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="Agent"
        component={AgentScene}
        durationInFrames={628}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="Commit"
        component={CommitScene}
        durationInFrames={270}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="Outro"
        component={Outro}
        durationInFrames={180}
        fps={30}
        width={1920}
        height={1080}
      />
    </Folder>
  </>
);
