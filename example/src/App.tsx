import { useRef, useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import { Kanji, createKanjiSource } from 'react-native-nitro-kanjivg-tgfx';
import type { KanjiHandle } from 'react-native-nitro-kanjivg-tgfx';

// `require.context` must be called from app code: the folder path has to be a
// static literal Metro can see at build time.
const kanjis = createKanjiSource(
  require.context('../assets/kanji', true, /\.svg$/)
);

export default function App() {
  const han = useRef<KanjiHandle>(null);
  const [writing, setWriting] = useState(false);

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>By character (directory lookup)</Text>
      <View style={styles.row}>
        {['東', '水', '木', '漢', '魂'].map((character) => (
          <Kanji
            key={character}
            character={character}
            source={kanjis}
            width={64}
            height={64}
          />
        ))}
      </View>

      <Text style={styles.heading}>By file (explicit require)</Text>
      <View style={styles.row}>
        <Kanji
          file={require('../assets/kanji/06f22.svg')}
          width={64}
          height={64}
        />
        <Kanji
          file={require('../assets/kanji/06728.svg')}
          width={64}
          height={64}
        />
        <Kanji
          file={require('../assets/kanji/09b42.svg')}
          width={64}
          height={64}
        />
      </View>

      <Text style={styles.heading}>Animated write-on (imperative control)</Text>
      <Kanji
        ref={han}
        character="漢"
        source={kanjis}
        animated
        width={160}
        height={160}
        stroke={{ color: '#227093', width: 4 }}
        strokes={{ 3: { color: '#d63031' } }}
        showStrokeNumbers
        strokeNumberColor="#495057"
        strokeNumbers={{
          3: { color: '#d63031', fontSize: 11 }, // matches the red stroke
          13: { visible: false }, // demo: hide one label
        }}
        onAnimationEnd={() => setWriting(false)}
      />
      <View style={styles.row}>
        <Button
          title={writing ? 'Writing…' : 'Write the strokes'}
          onPress={() => {
            setWriting(true);
            han.current?.restart();
          }}
        />
        <Button
          title="Pause"
          onPress={() => {
            setWriting(false);
            han.current?.pause();
          }}
        />
        <Button
          title="Seek to 50%"
          onPress={() => {
            setWriting(false);
            han.current?.seekTo(0.5);
          }}
        />
      </View>
      <View style={styles.row}>
        <Button title="0.5x speed" onPress={() => han.current?.setSpeed(0.5)} />
        <Button title="2x speed" onPress={() => han.current?.setSpeed(2)} />
        <Button
          title="Slow stroke 3"
          onPress={() => han.current?.setStrokeSpeed(3, 0.25)}
        />
      </View>

      <Text style={styles.heading}>With loops</Text>
      <Kanji
        character="魂"
        source={kanjis}
        animated
        autoPlay
        loop
        speed={1.5}
        width={96}
        height={96}
        stroke={{ color: '#4a4a7a' }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    gap: 12,
    padding: 16,
  },
  heading: { fontWeight: '600', marginTop: 8 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  footnote: { color: '#888', fontSize: 12 },
});
