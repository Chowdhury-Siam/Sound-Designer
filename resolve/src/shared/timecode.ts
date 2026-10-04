export class TimecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimecodeError";
  }
}

export const parseFrameRate = (value: unknown): number => {
  const frameRate = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(frameRate) || frameRate <= 0 || frameRate > 240) {
    throw new TimecodeError("Resolve returned an unsupported timeline frame rate.");
  }
  return frameRate;
};
export const timecodeToFrames = (timecode: string, frameRate: number): number => {
  const match = /^(\d{1,2}):(\d{2}):(\d{2})[:;](\d{2})$/.exec(timecode.trim());
  if (!match) throw new TimecodeError("Resolve returned an invalid playhead timecode.");
  const [, hoursText, minutesText, secondsText, framesText] = match;
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  const seconds = Number(secondsText);
  const frames = Number(framesText);
  const nominalRate = Math.round(frameRate);
  if (minutes > 59 || seconds > 59 || frames >= nominalRate) {
    throw new TimecodeError("Resolve returned an out-of-range playhead timecode.");
  }

  // Resolve's recordFrame uses the timeline's absolute frame space. Drop-frame
  // timecode needs the standard skipped-frame adjustment.
  const totalMinutes = hours * 60 + minutes;
  const baseFrames = ((hours * 3600 + minutes * 60 + seconds) * nominalRate) + frames;
  if (!timecode.includes(";") || (nominalRate !== 30 && nominalRate !== 60)) return baseFrames;
  const droppedPerMinute = nominalRate === 60 ? 4 : 2;
  return baseFrames - droppedPerMinute * (totalMinutes - Math.floor(totalMinutes / 10));
};
