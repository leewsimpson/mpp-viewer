# Third-party software in MPP Viewer

MPP Viewer reads project files with the open-source libraries below. They are
bundled unmodified, each as its own jar in the app's
`Contents/Resources/converter/lib` folder.

| Component | License | License text |
| --- | --- | --- |
| [MPXJ](https://www.mpxj.org) | GNU LGPL 2.1 or later | `LGPL-2.1.txt` |
| [Apache POI](https://poi.apache.org), Commons Codec, Collections, IO, Lang and Logging, [Log4j API](https://logging.apache.org/log4j/) | Apache 2.0 | `Apache-2.0.txt`, plus `META-INF/LICENSE` and `META-INF/NOTICE` inside each jar |
| [Jackcess](https://jackcess.sourceforge.io), [RTF Parser Kit](https://github.com/joniles/rtfparserkit), [SparseBitSet](https://github.com/brettwooldridge/SparseBitSet) | Apache 2.0 | `Apache-2.0.txt` |
| [jsoup](https://jsoup.org) | MIT | `jsoup-MIT.txt` |
| [Jakarta XML Binding, Jakarta Activation, JAXB runtime](https://eclipse-ee4j.github.io/jaxb-ri/) | Eclipse Distribution License 1.0 (BSD-3-Clause) | `META-INF/LICENSE.md` inside each jar |
| [OpenJDK](https://openjdk.org) runtime | GPL 2.0 with the Classpath Exception | `Contents/Resources/converter/runtime/legal` |

## Replacing MPXJ

As the LGPL allows, you can swap in your own build of MPXJ: replace
`mpxj-<version>.jar` in `Contents/Resources/converter/lib` with a jar of the
same name. Changing files inside the app breaks its code signature, so re-sign
it afterwards, for example with
`codesign --force --deep --sign - "/Applications/MPP Viewer.app"`.

The MPXJ source code is at <https://github.com/joniles/mpxj>.
