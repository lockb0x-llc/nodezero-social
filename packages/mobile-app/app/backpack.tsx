import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function BackpackScreen() {
  const [permissions, setPermissions] = useState({
    profile: true,
    interests: true,
    location: false,
  });

  const togglePermission = (key: keyof typeof permissions) => {
    setPermissions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <View style={styles.headerTitleContainer}>
          <Ionicons name="flash" size={28} color="#EAB308" />
          <Text style={styles.headerTitle}>Data Backpack</Text>
        </View>
        <Text style={styles.headerSubtitle}>
          Your decentralized Solid Pod. You own this data.
        </Text>
      </View>

      <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
        <Text style={styles.sectionTitle}>ACTIVE CARDS</Text>

        {/* Public Profile Card */}
        <View style={[styles.card, !permissions.profile && styles.cardDisabled]}>
          <View style={styles.cardHeader}>
            <View style={[styles.iconContainer, { backgroundColor: '#DBEAFE' }]}>
              <Ionicons name="person" size={24} color="#2563EB" />
            </View>
            <View style={styles.cardTextContainer}>
              <Text style={styles.cardTitle}>Public Profile</Text>
              <Text style={styles.cardDescription}>Avatar, Name, Bio</Text>
            </View>
          </View>
          <Switch
            value={permissions.profile}
            onValueChange={() => togglePermission('profile')}
            trackColor={{ false: '#E5E7EB', true: '#3B82F6' }}
            thumbColor={'#FFFFFF'}
          />
        </View>

        {/* Interest Graph Card */}
        <View style={[styles.card, !permissions.interests && styles.cardDisabled]}>
          <View style={styles.cardHeader}>
            <View style={[styles.iconContainer, { backgroundColor: '#F3E8FF' }]}>
              <Ionicons name="sparkles" size={24} color="#9333EA" />
            </View>
            <View style={styles.cardTextContainer}>
              <Text style={styles.cardTitle}>Interest Graph</Text>
              <Text style={styles.cardDescription}>Shared FOAF tags</Text>
            </View>
          </View>
          <Switch
            value={permissions.interests}
            onValueChange={() => togglePermission('interests')}
            trackColor={{ false: '#E5E7EB', true: '#3B82F6' }}
            thumbColor={'#FFFFFF'}
          />
        </View>

        {/* Location Card */}
        <View style={[styles.card, !permissions.location && styles.cardDisabled]}>
          <View style={styles.cardHeader}>
            <View style={[styles.iconContainer, { backgroundColor: '#F3F4F6' }]}>
              <Ionicons name="location" size={24} color="#6B7280" />
            </View>
            <View style={styles.cardTextContainer}>
              <Text style={styles.cardTitle}>Exact Location</Text>
              <Text style={styles.cardDescription}>H3 Index Precision</Text>
            </View>
          </View>
          <Switch
            value={permissions.location}
            onValueChange={() => togglePermission('location')}
            trackColor={{ false: '#E5E7EB', true: '#3B82F6' }}
            thumbColor={'#FFFFFF'}
          />
        </View>

        {/* Educational Info Box */}
        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            <Text style={{ fontWeight: 'bold' }}>Web3 Architecture: </Text>
            This data lives securely in your Pod. NodeZero is only a client reading your LDP containers based on these toggles.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginLeft: 36,
  },
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#9CA3AF',
    letterSpacing: 1.5,
    marginBottom: 12,
    marginLeft: 4,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  cardDisabled: {
    opacity: 0.6,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  cardTextContainer: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 2,
  },
  cardDescription: {
    fontSize: 13,
    color: '#6B7280',
  },
  infoBox: {
    marginTop: 10,
    backgroundColor: '#EFF6FF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  infoText: {
    fontSize: 13,
    color: '#1E40AF',
    lineHeight: 20,
  },
});
