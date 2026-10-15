import type { Metadata } from "next"

import { SignUpForm } from "./sign-up-form"

export const metadata: Metadata = { title: "Sign up · Fold" }

export default function SignUpPage() {
  return <SignUpForm />
}
