"""Pydantic models that mirror the Node `planSchema` (src/schema.js).

Validating the model output against these guarantees the JSON we hand back to
the Node planner is shape-compatible with the existing verifier, instruction
model, and evaluator. If a generation fails validation we can repair-and-retry
before falling back, instead of shipping broken JSON downstream.
"""

from __future__ import annotations

from enum import Enum
from typing import List

from pydantic import BaseModel, Field


class Difficulty(str, Enum):
    beginner = "beginner"
    intermediate = "intermediate"
    advanced = "advanced"


class RiskLevel(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


class Project(BaseModel):
    title: str
    summary: str
    inspired_by_style: str
    recommended_scope: str


class DetectedObject(BaseModel):
    category: str
    visible_parts: List[str]
    likely_materials: List[str]
    confidence: float = Field(ge=0, le=1)


class CostEstimate(BaseModel):
    low: float = Field(ge=0)
    high: float = Field(ge=0)
    notes: str


class Dimensions(BaseModel):
    width_in: float = Field(ge=0)
    depth_in: float = Field(ge=0)
    height_in: float = Field(ge=0)
    confidence: float = Field(ge=0, le=1)
    notes: str


class Material(BaseModel):
    name: str
    category: str
    quantity: float = Field(ge=0)
    unit: str
    estimated_unit_cost_usd: float = Field(ge=0)
    notes: str
    store_query: str
    alternatives: List[str]


class Step(BaseModel):
    title: str
    detail: str
    estimated_minutes: float = Field(ge=0)
    safety_notes: str


class Evaluation(BaseModel):
    buildability_score: float = Field(ge=0, le=100)
    risk_level: RiskLevel
    missing_inputs: List[str]
    verifier_notes: List[str]


class Plan(BaseModel):
    """Top-level plan. Field order matches src/schema.js for readability."""

    project: Project
    detected_object: DetectedObject
    assumptions: List[str]
    difficulty: Difficulty
    estimated_total_cost_usd: CostEstimate
    dimensions: Dimensions
    materials: List[Material] = Field(min_length=1)
    tools: List[str]
    steps: List[Step] = Field(min_length=1)
    safety_checks: List[str]
    routing_notes: List[str]
    evaluation: Evaluation


class Perception(BaseModel):
    """Lightweight image-understanding output (stage 1).

    Kept separate from the full plan so the VLM perception pass can be routed,
    cached, and benchmarked independently from plan generation.
    """

    category: str
    visible_parts: List[str]
    likely_materials: List[str]
    style: str
    approx_dimensions_note: str
    risk_level: RiskLevel
    confidence: float = Field(ge=0, le=1)
