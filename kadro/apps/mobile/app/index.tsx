import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <Text accessibilityRole="header" style={styles.wordmark}>
          KADRO
        </Text>
        <Text style={styles.tagline}>Kadron eksik kalmasın.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F4F6F0',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  wordmark: {
    color: '#0E1A14',
    fontSize: 40,
    fontWeight: '700',
    letterSpacing: 2,
  },
  tagline: {
    color: '#1B7F4B',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 12,
  },
});
