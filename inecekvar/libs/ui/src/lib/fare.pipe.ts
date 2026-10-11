import { Pipe, PipeTransform } from '@angular/core';
import { formatFareMinor } from '@inecekvar/domain';

/** Renders a fare in kuruş as Turkish lira; pair it with the `iv-fare` class for tabular digits. */
@Pipe({ name: 'ivFare' })
export class FarePipe implements PipeTransform {
  transform(minor: number): string {
    return formatFareMinor(minor);
  }
}
