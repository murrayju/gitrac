import { linearTiming, TransitionSeries } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { useVideoConfig } from 'remotion';
import { AgentScene } from './scenes/AgentScene';
import { AuthorScene } from './scenes/AuthorScene';
import { CommitScene } from './scenes/CommitScene';
import { FilesScene } from './scenes/FilesScene';
import { Intro } from './scenes/Intro';
import { Outro } from './scenes/Outro';

/** The full promo: a person plans the work, an agent does it, git keeps the record. */
export const Promo: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <TransitionSeries name="Promo">
      <TransitionSeries.Sequence
        name="Intro"
        durationInFrames={105}
        premountFor={fps}
      >
        <Intro />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: 15 })}
      />
      <TransitionSeries.Sequence
        name="Author"
        durationInFrames={550}
        premountFor={fps}
      >
        <AuthorScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: 15 })}
      />
      <TransitionSeries.Sequence
        name="Files"
        durationInFrames={285}
        premountFor={fps}
      >
        <FilesScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: 15 })}
      />
      <TransitionSeries.Sequence
        name="Agent"
        durationInFrames={628}
        premountFor={fps}
      >
        <AgentScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: 15 })}
      />
      <TransitionSeries.Sequence
        name="Commit"
        durationInFrames={270}
        premountFor={fps}
      >
        <CommitScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: 15 })}
      />
      <TransitionSeries.Sequence
        name="Outro"
        durationInFrames={180}
        premountFor={fps}
      >
        <Outro />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
