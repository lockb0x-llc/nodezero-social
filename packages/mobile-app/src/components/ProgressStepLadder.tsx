/**
 * @module components/ProgressStepLadder
 *
 * A vertical checklist ("step ladder") that shows the major operations of a
 * long-running flow. Completed steps show a filled check, the active step
 * shows a spinner, failed steps show a cross, and not-yet-started steps are
 * greyed out. Used by the account-creation flow (landing) and the sign-in
 * attestation verification flow (onboarding).
 */

import React from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { aesthetic } from '../theme/aesthetic'

export type ProgressStepStatus = 'pending' | 'active' | 'done' | 'error'

export interface ProgressStep {
  /** Stable identifier for the step. */
  key: string
  /** User-facing label describing the operation. */
  label: string
  /** Current state of the step. */
  status: ProgressStepStatus
}

function StepIndicator({ status }: { status: ProgressStepStatus }): JSX.Element {
  if (status === 'active') {
    return (
      <View style={styles.indicator}>
        <ActivityIndicator size="small" color={aesthetic.color.accentSoft} />
      </View>
    )
  }
  if (status === 'done') {
    return (
      <View style={[styles.indicator, styles.indicatorDone]}>
        <Text style={styles.indicatorGlyphDone}>✓</Text>
      </View>
    )
  }
  if (status === 'error') {
    return (
      <View style={[styles.indicator, styles.indicatorError]}>
        <Text style={styles.indicatorGlyphError}>✕</Text>
      </View>
    )
  }
  return <View style={[styles.indicator, styles.indicatorPending]} />
}

export function ProgressStepLadder({ steps }: { steps: ProgressStep[] }): JSX.Element | null {
  if (steps.length === 0) return null

  return (
    <View style={styles.ladder} accessibilityRole="progressbar" accessibilityLabel="Progress steps">
      {steps.map((step, index) => (
        <View key={step.key} style={styles.stepRow}>
          <View style={styles.railColumn}>
            <StepIndicator status={step.status} />
            {index < steps.length - 1 ? (
              <View
                style={[
                  styles.rail,
                  step.status === 'done' ? styles.railDone : styles.railPending,
                ]}
              />
            ) : null}
          </View>
          <Text
            style={[
              styles.stepLabel,
              step.status === 'pending' && styles.stepLabelPending,
              step.status === 'active' && styles.stepLabelActive,
              step.status === 'done' && styles.stepLabelDone,
              step.status === 'error' && styles.stepLabelError,
            ]}
            accessibilityLabel={`${step.label}: ${step.status}`}
          >
            {step.label}
          </Text>
        </View>
      ))}
    </View>
  )
}

const INDICATOR_SIZE = 22

const styles = StyleSheet.create({
  ladder: {
    alignSelf: 'stretch',
    marginVertical: 12,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  railColumn: {
    alignItems: 'center',
    width: INDICATOR_SIZE,
    marginRight: 12,
  },
  rail: {
    width: 2,
    height: 16,
    marginVertical: 2,
    borderRadius: 1,
  },
  railDone: {
    backgroundColor: aesthetic.color.success,
  },
  railPending: {
    backgroundColor: aesthetic.color.border,
  },
  indicator: {
    width: INDICATOR_SIZE,
    height: INDICATOR_SIZE,
    borderRadius: INDICATOR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicatorPending: {
    borderWidth: 2,
    borderColor: aesthetic.color.border,
  },
  indicatorDone: {
    backgroundColor: aesthetic.color.success,
  },
  indicatorError: {
    backgroundColor: aesthetic.color.danger,
  },
  indicatorGlyphDone: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 15,
  },
  indicatorGlyphError: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 14,
  },
  stepLabel: {
    flex: 1,
    fontSize: 14,
    lineHeight: INDICATOR_SIZE,
    paddingBottom: 8,
  },
  stepLabelPending: {
    color: aesthetic.color.textLow,
    opacity: 0.55,
  },
  stepLabelActive: {
    color: aesthetic.color.textHigh,
    fontWeight: '700',
  },
  stepLabelDone: {
    color: aesthetic.color.textMid,
  },
  stepLabelError: {
    color: aesthetic.color.danger,
    fontWeight: '700',
  },
})
