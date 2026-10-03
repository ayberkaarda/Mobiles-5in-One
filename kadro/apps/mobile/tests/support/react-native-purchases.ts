/**
 * Test double of `react-native-purchases`: the real module needs the native store bridge. Unit
 * tests never reach a store; they inject a fake billing port or a fake SDK, so every call on this
 * double fails loudly instead of silently doing nothing.
 */
function unavailable(name: string): never {
  throw new Error(`react-native-purchases.${name} is not available in unit tests`);
}

const Purchases = {
  configure: () => unavailable('configure'),
  logIn: () => unavailable('logIn'),
  logOut: () => unavailable('logOut'),
  getOfferings: () => unavailable('getOfferings'),
  purchasePackage: () => unavailable('purchasePackage'),
  restorePurchases: () => unavailable('restorePurchases'),
  getCustomerInfo: () => unavailable('getCustomerInfo'),
};

export default Purchases;
