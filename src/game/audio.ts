/** Entirely synthesized locally; no audio requests or autoplay before a gesture. */
export class WorldAudio {
  private context?: AudioContext
  private gain?: GainNode
  private ambience?: GainNode
  private lastEffect = 0
  volume = 0.3
  muted = true

  async unlock(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext()
      this.gain = this.context.createGain()
      this.gain.gain.value = this.muted ? 0 : this.volume
      this.gain.connect(this.context.destination)
      this.ambience = this.context.createGain()
      this.ambience.gain.value = 0.045
      this.ambience.connect(this.gain)
      // Quiet wind through a low-pass filter, plus two soft harmonic tones.
      const buffer = this.context.createBuffer(1, this.context.sampleRate * 4, this.context.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
      const noise = this.context.createBufferSource()
      noise.buffer = buffer; noise.loop = true
      const filter = this.context.createBiquadFilter()
      filter.type = 'lowpass'; filter.frequency.value = 400
      noise.connect(filter); filter.connect(this.ambience); noise.start()
      for (const hz of [196, 294]) {
        const tone = this.context.createOscillator()
        const level = this.context.createGain()
        tone.frequency.value = hz; level.gain.value = 0.05
        tone.connect(level); level.connect(this.ambience); tone.start()
      }
    }
    if (this.context.state === 'suspended') await this.context.resume()
  }
  setVolume(value: number): void { this.volume = value; this.update() }
  setMuted(value: boolean): void { this.muted = value; this.update() }
  private update(): void {
    if (this.gain && this.context) this.gain.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.context.currentTime, 0.08)
  }
  effect(danger = false): void {
    if (!this.context || !this.gain || this.muted || this.context.currentTime - this.lastEffect < 0.15) return
    this.lastEffect = this.context.currentTime
    const osc = this.context.createOscillator(), level = this.context.createGain()
    osc.type = danger ? 'triangle' : 'sine'
    osc.frequency.setValueAtTime(danger ? 100 : 650, this.context.currentTime)
    osc.frequency.exponentialRampToValueAtTime(danger ? 40 : 420, this.context.currentTime + 0.15)
    level.gain.setValueAtTime(0.1, this.context.currentTime)
    level.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + 0.2)
    osc.connect(level); level.connect(this.gain)
    osc.start(); osc.stop(this.context.currentTime + 0.21)
    osc.onended = () => { osc.disconnect(); level.disconnect() }
  }
  suspend(): void { void this.context?.suspend() }
}
