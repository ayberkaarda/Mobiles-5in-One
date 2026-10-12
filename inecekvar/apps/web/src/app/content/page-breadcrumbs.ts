import { CityDetail, StopOut } from './public-types';
import { busStop } from '../seo/json-ld';

export function cityCrumbs(city: CityDetail): { name: string; path: string }[] {
  return [
    { name: 'İnecek Var', path: '/' },
    { name: city.name, path: '/' + city.slug },
  ];
}

export function stopNode(origin: string, city: CityDetail, stop: StopOut) {
  return busStop(origin, {
    name: stop.name,
    path: `/${city.slug}/durak/${stop.slug}`,
    longitude: stop.location[0],
    latitude: stop.location[1],
  });
}
