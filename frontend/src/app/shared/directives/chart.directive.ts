import { DestroyRef, Directive, ElementRef, effect, inject, input } from '@angular/core';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  ChartConfiguration,
  Legend,
  LinearScale,
  Tooltip,
} from 'chart.js';

// register only what the dashboard uses to keep the bundle small
Chart.register(BarController, BarElement, CategoryScale, LinearScale, Legend, Tooltip);

@Directive({ selector: 'canvas[appChart]' })
export class ChartDirective {
  readonly config = input.required<ChartConfiguration>({ alias: 'appChart' });

  private readonly canvas = inject<ElementRef<HTMLCanvasElement>>(ElementRef).nativeElement;
  private chart?: Chart;

  constructor() {
    effect(() => {
      const config = this.config();
      this.chart?.destroy();
      this.chart = new Chart(this.canvas, config);
    });

    inject(DestroyRef).onDestroy(() => this.chart?.destroy());
  }
}
